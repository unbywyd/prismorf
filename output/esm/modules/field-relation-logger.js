import treeify from "treeify";
import chalk from 'chalk';
import boxen from 'boxen';
import { PrismaQlRelationCollector } from "./field-relation-collector.js";
import pkg from '@prisma/internals';
const { getDMMF } = pkg;
import fs from 'fs';
const collector = new PrismaQlRelationCollector();
export class PrismaQlFieldRelationLogger {
    relations;
    setRelations(relations) {
        this.relations = relations;
    }
    constructor(relations) {
        if (relations) {
            this.setRelations(relations);
        }
    }
    buildJsonModelTrees(rootModel, relations, maxDepth, depth = 0, visitedModels = new Set()) {
        if (depth > maxDepth || visitedModels.has(rootModel)) {
            return { trees: [], models: new Set(), relations: new Set() };
        }
        visitedModels.add(rootModel);
        let trees = [];
        let models = new Set();
        let relationsSet = new Set();
        const modelRelations = relations.filter(rel => rel.modelName === rootModel);
        let relationNodes = [];
        for (const relation of modelRelations) {
            const isSelfRelation = relation.modelName === relation.relatedModel;
            const isList = (relation.type === "1:M" || relation.type === "M:N") && !relation.foreignKey;
            let relationNode = {
                relatedModel: relation.relatedModel,
                field: relation.fieldName || relation.modelName,
                type: relation.type,
                alias: relation.fieldName || relation.relationName,
                foreignKey: relation.foreignKey,
                referenceKey: relation.referenceKey,
                relationTable: relation.relationTable,
                inverseField: relation.inverseField,
                constraints: relation.constraints || [],
                isSelfRelation,
                isList,
            };
            models.add(rootModel);
            models.add(relation.relatedModel);
            relationsSet.add(`${rootModel} -> ${relation.relatedModel}`);
            const subTree = this.buildJsonModelTrees(relation.relatedModel, relations, maxDepth, depth + 1, visitedModels);
            if (subTree.trees.length > 0) {
                relationNode.subTree = subTree.trees[0];
            }
            relationNodes.push(relationNode);
        }
        trees.push({ model: rootModel, relations: relationNodes });
        return { trees, models, relations: relationsSet };
    }
    buildModelTrees(rootModel, relations, maxDepth, depth = 0, visitedModels = new Set()) {
        if (depth > maxDepth || visitedModels.has(rootModel))
            return { trees: [], models: new Set(), relations: new Set() };
        visitedModels.add(rootModel);
        let trees = [];
        let models = new Set();
        let relationsSet = new Set();
        const modelRelations = relations.filter(rel => rel.modelName === rootModel);
        let table = {};
        for (const relation of modelRelations) {
            const relationType = relation.type;
            const name = relation.fieldName || relation.modelName;
            const relationAlias = `(as ${relation.fieldName || relation.relationName})`;
            // Determine if the relation is self-referencing
            const isSelfRelation = relation.modelName === relation.relatedModel;
            const selfRelationIcon = isSelfRelation ? chalk.yellow("🔁") : ""; // Add self-relation icon
            let keyInfo = chalk.gray("[-]");
            if (relation.foreignKey) {
                const direction = relation.relationDirection === "backward" ? "←" : "→";
                keyInfo = `[FK: ${chalk.blue(relation.foreignKey)} ${direction} ${chalk.green(relation.referenceKey || "id")}]`;
            }
            else if (relation.relationTable) {
                keyInfo = `[M:N via ${chalk.yellow(relation.relationTable)}]`;
            }
            if (relation.relationTable && relation.relationTable !== relation.modelName) {
                if (!table[relation.relationTable]) {
                    table[relation.relationTable] = {}; // Adding join table
                }
                // Add relation inside join table
                table[relation.relationTable][`→ ${chalk.yellow(relation.modelName)}:${chalk.cyan(relation.fieldName)} [FK: ${chalk.blue(relation.foreignKey || "?")} → ${chalk.green(relation.referenceKey || "?")}]`] = {};
                table[relation.relationTable][`→ ${chalk.yellow(relation.relatedModel)}:${chalk.cyan(relation.inverseField)} [FK: ${chalk.blue(relation.foreignKey || "?")} → ${chalk.green(relation.referenceKey || "?")}]`] = {};
            }
            const constraints = relation?.constraints?.length
                ? `Constraints: ${chalk.magenta(relation.constraints.join(", "))}`
                : "";
            const isList = (relationType === "1:M" || relationType === "M:N") && !relation?.foreignKey;
            let relationLabel = `→ ${chalk.yellow(relation.relatedModel + (isList ? '[]' : ''))}:${chalk.cyan(name)} ${relationAlias} ${chalk.red(relationType)} ${keyInfo} ${constraints} ${selfRelationIcon}`;
            if (!table[relationLabel]) {
                table[relationLabel] = {};
            }
            // Add to statistics
            models.add(rootModel);
            models.add(relation.relatedModel);
            relationsSet.add(`${rootModel} -> ${relation.relatedModel}`);
        }
        trees.push({ [chalk.bold(rootModel)]: table });
        for (const relation of modelRelations) {
            const subTree = this.buildModelTrees(relation.relatedModel, relations, maxDepth, depth + 1, visitedModels);
            trees = trees.concat(subTree.trees);
            subTree.models.forEach(m => models.add(m));
            subTree.relations.forEach(r => relationsSet.add(r));
        }
        return { trees, models, relations: relationsSet };
    }
    getRelationStatistics(modelName, maxDepth = 1) {
        if (!this.relations?.length) {
            throw new Error('No relations found. Please run relation-collector first and use the setRelations method to set the relations.');
        }
        let relatedModels = new Set(); // Unique models
        let relationCount = 0; // Number of relations
        // Recursive function to traverse relations
        const exploreRelations = (currentModel, depth) => {
            if (depth > maxDepth || relatedModels.has(currentModel))
                return;
            relatedModels.add(currentModel);
            // Filter relations for the current model
            for (const rel of this.relations.filter(r => r.modelName === currentModel)) {
                relationCount++;
                exploreRelations(rel.relatedModel, depth + 1);
            }
        };
        // Start traversal from `modelName`
        exploreRelations(modelName, 1);
        return {
            uniqueModels: relatedModels.size, // Number of unique models
            totalRelations: relationCount, // Total number of relations
            maxDepth // Depth passed from outside
        };
    }
    collectRelationStatistics(models, relations, rootModel, maxDepth) {
        const directRelations = rootModel ? [...relations].filter(r => r.startsWith(rootModel)) : [...relations];
        return {
            uniqueModels: models.size,
            totalRelations: relations.size,
            directRelations: directRelations.length,
            maxDepth
        };
    }
    async parseSchemaAndSetRelations(schema) {
        const dmmf = await getDMMF({ datamodel: schema });
        const models = dmmf.datamodel.models;
        this.setRelations(await collector.setModels(models));
        return this.relations;
    }
    async provideRelationsFromBuilder(builder) {
        const schema = builder.print({ sort: true });
        return this.parseSchemaAndSetRelations(schema);
    }
    async provideRelationsFromSchema(schema) {
        return this.parseSchemaAndSetRelations(schema);
    }
    async privideRelationByPrismaPath(prismaPath) {
        const prismaSchemaContent = fs.readFileSync(prismaPath, 'utf-8');
        return this.parseSchemaAndSetRelations(prismaSchemaContent);
    }
    generateRelationTreeLog(rootModel, maxDepth = 1, relations) {
        if (relations?.length) {
            this.setRelations(relations);
        }
        if (!this.relations?.length) {
            throw new Error('No relations found.');
        }
        const { models, relations: rels, trees } = this.buildModelTrees(rootModel, this.relations, maxDepth);
        // Collect statistics
        const stats = this.collectRelationStatistics(models, rels, rootModel, maxDepth);
        let output = `${chalk.green.bold('📊 Relation Tree Statistics')}\n`;
        output += `${chalk.yellow('Model:')} ${chalk.bold(rootModel)}\n`;
        output += `${chalk.cyan('Max Depth:')} ${chalk.bold(maxDepth)}\n`;
        output += `${chalk.blue('Related Models:')} ${chalk.bold(stats.uniqueModels)}\n`;
        output += `${chalk.magenta('Total Relations:')} ${chalk.bold(stats.totalRelations)}\n`;
        output += `${chalk.redBright('Direct Relations:')} ${chalk.bold(stats.directRelations)}\n`;
        // direct relations
        let treeOutput = '';
        for (const tree of trees) {
            treeOutput += treeify.asTree(tree, true, true) + '\n';
        }
        const results = [...rels.values()].filter(el => {
            return el.startsWith(rootModel) || el.endsWith(rootModel);
        }).map(r => chalk.gray(r)).join('\n');
        const relsList = `${chalk.white.bold('🔗 Direct Relations')}\n${results}`;
        // Output statistics + tree, without extra spaces
        return boxen(output.trim() + '\n' + treeOutput.trim() + `\n\n${relsList}`, {
            padding: 1,
            borderColor: 'green',
            borderStyle: 'round'
        });
    }
}
export const getRelationStatistics = (relations, modelName, maxDepth = 1) => {
    let relatedModels = new Set(); // Unique models
    let relationCount = 0; // Number of relations
    // Recursive function to traverse relations
    const exploreRelations = (currentModel, depth) => {
        if (depth > maxDepth || relatedModels.has(currentModel))
            return;
        relatedModels.add(currentModel);
        // Filter relations for the current model
        for (const rel of relations.filter(r => r.modelName === currentModel)) {
            relationCount++;
            exploreRelations(rel.relatedModel, depth + 1);
        }
    };
    // Start traversal from `modelName`
    exploreRelations(modelName, 1);
    return {
        uniqueModels: relatedModels.size, // Number of unique models
        totalRelations: relationCount, // Total number of relations
        maxDepth // Depth passed from outside
    };
};
//# sourceMappingURL=field-relation-logger.js.map