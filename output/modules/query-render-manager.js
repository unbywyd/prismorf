import { parseCommand } from "./dsl.js";
import PrismaSchemaManager from "./manager.js";
import { provideQueryRenderHandlers } from "./provider-renders.js";
const loadQueryRenderManager = async () => {
    const manager = new PrismaSchemaManager();
    provideQueryRenderHandlers(manager);
    await manager.loadFromFile();
    return (sourceCommand) => {
        try {
            const command = parseCommand(sourceCommand);
            return manager.query(command);
        }
        catch (error) {
            console.error("Error parsing command:", error.message);
        }
    };
};
export default loadQueryRenderManager;
//# sourceMappingURL=query-render-manager.js.map