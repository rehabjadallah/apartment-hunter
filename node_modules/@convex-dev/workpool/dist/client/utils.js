import { getFunctionAddress, getFunctionName, } from "convex/server";
export function safeFunctionName(f) {
    const address = getFunctionAddress(f);
    return (address.name ||
        address.reference ||
        address.functionHandle ||
        getFunctionName(f));
}
//# sourceMappingURL=utils.js.map