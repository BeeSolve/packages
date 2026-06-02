/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "beesolve" },
  rules: {
    "prefer-props-object": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Enforce single props/options object parameter. Allows 2 object params for handler pattern.",
        },
        schema: [
          {
            type: "object",
            properties: {
              maxParams: { type: "integer" },
              allowTwoObjectParams: { type: "boolean" },
            },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const options = context.options[0] || {};
        const maxParams = options.maxParams ?? 1;
        const allowTwoObjectParams = options.allowTwoObjectParams ?? true;

        function isObjectShaped(param) {
          if (param.type === "ObjectPattern") return true;
          if (param.type === "AssignmentPattern" && param.left.type === "ObjectPattern")
            return true;
          if (param.typeAnnotation) {
            const ann = param.typeAnnotation.typeAnnotation || param.typeAnnotation;
            if (
              ann.type === "TSTypeLiteral" ||
              ann.type === "TSTypeReference" ||
              ann.type === "TSIntersectionType"
            )
              return true;
          }
          return false;
        }

        function check(node) {
          const params = node.params;
          if (params.length <= maxParams) return;

          if (allowTwoObjectParams && params.length === 2) {
            if (params.every(isObjectShaped)) return;
          }

          context.report({
            node,
            message: `Function has ${params.length} parameters. Prefer a single props/options object.`,
          });
        }

        return {
          FunctionDeclaration: check,
          FunctionExpression: check,
          ArrowFunctionExpression: check,
        };
      },
    },

    "valibot-namespace-import": {
      meta: {
        type: "problem",
        docs: { description: 'Enforce `import * as v from "valibot"`.' },
        fixable: "code",
      },
      create(context) {
        return {
          ImportDeclaration(node) {
            if (node.source.value !== "valibot") return;

            // Must be namespace import: import * as v from "valibot"
            if (
              node.specifiers.length === 1 &&
              node.specifiers[0].type === "ImportNamespaceSpecifier" &&
              node.specifiers[0].local.name === "v"
            ) {
              return;
            }

            context.report({
              node,
              message: 'Import valibot as namespace: `import * as v from "valibot"`.',
              fix(fixer) {
                return fixer.replaceText(node, 'import * as v from "valibot";');
              },
            });
          },
        };
      },
    },

    "no-valibot-date": {
      meta: {
        type: "problem",
        docs: { description: "Ban v.date(). Use v.isoDateTime() instead." },
        fixable: "code",
      },
      create(context) {
        return {
          CallExpression(node) {
            if (
              node.callee.type === "MemberExpression" &&
              node.callee.object.type === "Identifier" &&
              node.callee.object.name === "v" &&
              node.callee.property.type === "Identifier" &&
              node.callee.property.name === "date"
            ) {
              context.report({
                node,
                message:
                  "Use v.isoDateTime() instead of v.date(). Compare date strings with localeCompare().",
                fix(fixer) {
                  return fixer.replaceText(node.callee.property, "isoDateTime");
                },
              });
            }
          },
        };
      },
    },

    "naming-conventions": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Enforce camelCase for values, PascalCase for types/interfaces.",
        },
      },
      create(context) {
        const PASCAL = /^[A-Z][a-zA-Z0-9]*$/;
        const CAMEL_OR_UPPER = /^[a-z][a-zA-Z0-9]*$|^[A-Z][A-Z0-9_]*$|^_/;

        function checkPascal(node) {
          if (!node.id || !node.id.name) return;
          if (!PASCAL.test(node.id.name)) {
            context.report({
              node: node.id,
              message: `Type/interface "${node.id.name}" must be PascalCase.`,
            });
          }
        }

        function checkCamel(node) {
          if (!node.name) return;
          // Ignore destructured, imports, and _prefixed (unused)
          if (node.name.startsWith("_")) return;
          if (!CAMEL_OR_UPPER.test(node.name)) {
            context.report({
              node,
              message: `"${node.name}" must be camelCase or UPPER_CASE.`,
            });
          }
        }

        return {
          TSTypeAliasDeclaration: checkPascal,
          TSInterfaceDeclaration: checkPascal,

          // Check variable declarations (skip destructuring)
          "VariableDeclarator > Identifier.id"(node) {
            if (node.parent.id !== node) return;
            checkCamel(node);
          },
          "FunctionDeclaration > Identifier.id": checkCamel,
        };
      },
    },
  },
};

export default plugin;
