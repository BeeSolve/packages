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

          // Allow class constructors (CDK Construct pattern: scope, id, props)
          if (
            node.type === "FunctionExpression" &&
            node.parent?.type === "MethodDefinition" &&
            node.parent.kind === "constructor"
          ) {
            return;
          }

          // Allow callbacks (functions passed as arguments to other functions)
          if (node.parent?.type === "CallExpression" && node.parent.callee !== node) {
            return;
          }

          // Allow functions inside array literals (e.g. [handler, fns])
          if (node.parent?.type === "ArrayExpression") {
            return;
          }

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
        docs: { description: "Ban v.date(). Use v.isoTimestamp() instead." },
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
                  "Use v.isoTimestamp() instead of v.date(). Compare date strings with localeCompare().",
                fix(fixer) {
                  return fixer.replaceText(node.callee.property, "isoTimestamp");
                },
              });
            }
          },
        };
      },
    },

    "no-then-chains": {
      meta: {
        type: "suggestion",
        docs: { description: "Ban .then() chains. Use async/await instead." },
      },
      create(context) {
        return {
          "CallExpression > MemberExpression.callee[property.name='then']"(node) {
            context.report({
              node: node.property,
              message: "Use `await` instead of `.then()` chains.",
            });
          },
        };
      },
    },

    "readonly-props": {
      meta: {
        type: "suggestion",
        docs: { description: "Enforce readonly on interface and type literal properties." },
      },
      create(context) {
        return {
          "TSInterfaceDeclaration TSPropertySignature[readonly=false]"(node) {
            context.report({
              node: node.key,
              message: `Property "${node.key.name || node.key.value}" should be readonly.`,
            });
          },
          "TSTypeLiteral TSPropertySignature[readonly=false]"(node) {
            context.report({
              node: node.key,
              message: `Property "${node.key.name || node.key.value}" should be readonly.`,
            });
          },
        };
      },
    },

    "naming-conventions": {
      meta: {
        type: "suggestion",
        docs: {
          description:
            "Enforce camelCase for values, PascalCase for types/interfaces and React components.",
        },
      },
      create(context) {
        const pascalRe = /^[A-Z][a-zA-Z0-9]*$/;
        const camelOrPascalRe = /^[a-z][a-zA-Z0-9]*$|^[A-Z][a-zA-Z0-9]*$|^_/;

        function checkPascal(node) {
          if (!node.id || !node.id.name) return;
          if (!pascalRe.test(node.id.name)) {
            context.report({
              node: node.id,
              message: `Type/interface "${node.id.name}" must be PascalCase.`,
            });
          }
        }

        function checkCamel(node) {
          if (!node.name) return;
          if (node.name.startsWith("_")) return;
          if (!camelOrPascalRe.test(node.name)) {
            context.report({
              node,
              message: `"${node.name}" must be camelCase (or PascalCase for components).`,
            });
          }
        }

        return {
          TSTypeAliasDeclaration: checkPascal,
          TSInterfaceDeclaration: checkPascal,

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
