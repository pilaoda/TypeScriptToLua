import * as path from "path";
import * as resolve from "resolve";
import * as ts from "typescript";
// TODO: Don't depend on CLI?
import * as cliDiagnostics from "../cli/diagnostics";
import * as diagnosticFactories from "./diagnostics";

export const getConfigDirectory = (options: ts.CompilerOptions) =>
    options.configFilePath ? path.dirname(options.configFilePath) : process.cwd();

export function resolvePlugin(
    kind: string,
    optionName: string,
    basedir: string,
    query: string,
    importName = "default"
): { error?: ts.Diagnostic; result?: unknown } {
    if (typeof query !== "string") {
        return { error: cliDiagnostics.compilerOptionRequiresAValueOfType(optionName, "string") };
    }

    let resolved: string;
    try {
        resolved = resolve.sync(query, { basedir, extensions: [".js", ".ts", ".tsx"] });
    } catch (err) {
        if (err.code !== "MODULE_NOT_FOUND") throw err;
        return { error: diagnosticFactories.couldNotResolveFrom(kind, query, basedir) };
    }

    // tslint:disable-next-line: deprecation
    const hasNoRequireHook = require.extensions[".ts"] === undefined;
    if (hasNoRequireHook && (resolved.endsWith(".ts") || resolved.endsWith(".tsx"))) {
        try {
            const tsNodePath = resolve.sync("ts-node", { basedir });
            const tsNode: typeof import("ts-node") = require(tsNodePath);
            tsNode.register({ transpileOnly: true });
        } catch (err) {
            if (err.code !== "MODULE_NOT_FOUND") throw err;
            return { error: diagnosticFactories.toLoadItShouldBeTranspiled(kind, query) };
        }
    }

    const commonjsModule = require(resolved);
    const factoryModule = commonjsModule.__esModule ? commonjsModule : { default: commonjsModule };
    const result = factoryModule[importName];
    if (result === undefined) {
        return { error: diagnosticFactories.shouldHaveAExport(kind, query, importName) };
    }

    return { result };
}