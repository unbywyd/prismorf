import { handlerResponse } from "../../handler-registries/handler-registry.js";
import { useHelper } from "../../utils/schema-helper.js";
export const sortModelNames = (modelNames) => {
    modelNames.sort((a, b) => a.localeCompare(b));
};
export const getJsonModelNames = (prismaState, data) => {
    const response = handlerResponse(data);
    const models = useHelper(prismaState).getModels();
    if (models.length === 0) {
        return response.result({
            total: 0,
            models: [],
        });
    }
    const modelNames = models.map(model => model.name);
    sortModelNames(modelNames);
    // Final output in a box
    return response.result({
        total: modelNames.length,
        models: modelNames,
    });
};
//# sourceMappingURL=get-model-names.js.map