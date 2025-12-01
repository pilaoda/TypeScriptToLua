import * as ts from "typescript";
import * as lua from "../../../../LuaAST";
import { TransformationContext } from "../../../context";
import { transformFunctionToExpression } from "../../function";
import { transformPropertyName } from "../../literal";
import { isStaticNode } from "../utils";
import { createPrototypeName } from "./constructor";
import { createClassMethodDecoratingExpression } from "../decorators";
import { setJSDocComments } from "../../../utils/lua-ast";

export function transformMemberExpressionOwnerName(
    node: ts.PropertyDeclaration | ts.MethodDeclaration | ts.AccessorDeclaration,
    className: lua.Identifier
): lua.Expression {
    return isStaticNode(node) ? lua.cloneIdentifier(className) : createPrototypeName(className);
}

export function transformMethodName(context: TransformationContext, node: ts.MethodDeclaration): lua.Expression {
    const methodName = transformPropertyName(context, node.name);
    if (lua.isStringLiteral(methodName) && methodName.value === "toString") {
        return lua.createStringLiteral("__tostring", node.name);
    }
    return methodName;
}

export function transformMethodDeclaration(
    context: TransformationContext,
    node: ts.MethodDeclaration,
    className: lua.Identifier
): lua.Statement[] {
    // Don't transform methods without body (overload declarations)
    if (!node.body) return [];

    const methodTable = transformMemberExpressionOwnerName(node, className);
    const methodName = transformMethodName(context, node);
    const [functionExpression] = transformFunctionToExpression(context, node);

    const methodHasDecorators = (ts.getDecorators(node)?.length ?? 0) > 0;
    const methodHasParameterDecorators = node.parameters.some(p => (ts.getDecorators(p)?.length ?? 0) > 0); // Legacy decorators

    if (methodHasDecorators || methodHasParameterDecorators) {
        if (context.options.experimentalDecorators) {
            // Legacy decorator statement
            const assignment = lua.createAssignmentStatement(
                lua.createTableIndexExpression(methodTable, methodName),
                functionExpression
            );
            setJSDocComments(context, node, undefined, assignment);
            return [
                assignment,
                lua.createExpressionStatement(
                    createClassMethodDecoratingExpression(context, node, functionExpression, className)
                ),
            ];
        } else {
            const assignment = lua.createAssignmentStatement(
                lua.createTableIndexExpression(methodTable, methodName),
                createClassMethodDecoratingExpression(context, node, functionExpression, className),
                node
            );
            setJSDocComments(context, node, undefined, assignment);
            return [assignment];
        }
    } else {
        const assignment = lua.createAssignmentStatement(
            lua.createTableIndexExpression(methodTable, methodName),
            functionExpression,
            node
        );
        setJSDocComments(context, node, undefined, assignment);
        return [assignment];
    }
}
