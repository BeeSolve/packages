/** @type {import("eslint").ESLint.Plugin} */
const plugin = {
  meta: { name: "beesolve" },
  rules: {
    "prefer-props-object": {
      meta: {
        type: "suggestion",
        docs: {
          description: "Suggest single props/options object when function signature is complex.",
        },
        schema: [
          {
            type: "object",
            properties: {
              minParams: { type: "integer" },
            },
            additionalProperties: false,
          },
        ],
      },
      create(context) {
        const options = context.options[0] || {};
        const minParams = options.minParams ?? 3;

        function getTypeString(param) {
          const ann = param.typeAnnotation?.typeAnnotation || param.typeAnnotation;
          if (!ann) return null;
          if (ann.type === "TSTypeReference" && ann.typeName) {
            return ann.typeName.name || null;
          }
          if (ann.type === "TSStringKeyword") return "string";
          if (ann.type === "TSNumberKeyword") return "number";
          if (ann.type === "TSBooleanKeyword") return "boolean";
          return ann.type;
        }

        function hasDuplicateTypes(params) {
          const types = params.map(getTypeString).filter(Boolean);
          return types.length !== new Set(types).size;
        }

        function check(node) {
          const params = node.params;
          if (params.length < minParams) return;

          // Allow class constructors (CDK Construct pattern: scope, id, props)
          if (
            node.type === "FunctionExpression" &&
            node.parent?.type === "MethodDefinition" &&
            node.parent.kind === "constructor"
          ) {
            return;
          }

          // Allow callbacks (functions passed as arguments)
          if (node.parent?.type === "CallExpression" && node.parent.callee !== node) {
            return;
          }

          // Allow functions inside array literals
          if (node.parent?.type === "ArrayExpression") {
            return;
          }

          // Allow non-exported functions (only warn on exported members)
          if (node.type === "FunctionDeclaration") {
            const parentType = node.parent?.type;
            if (
              parentType !== "ExportNamedDeclaration" &&
              parentType !== "ExportDefaultDeclaration"
            ) {
              return;
            }
          }
          if (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") {
            const varDeclarator = node.parent;
            if (varDeclarator?.type === "VariableDeclarator") {
              const varDecl = varDeclarator.parent;
              const grandParent = varDecl?.parent;
              if (
                grandParent?.type !== "ExportNamedDeclaration" &&
                grandParent?.type !== "ExportDefaultDeclaration"
              ) {
                return;
              }
            } else if (node.parent?.type === "Property") {
              // Object method — skip
              return;
            }
          }

          // Only warn if params >= minParams AND have duplicate types (easy to swap)
          // OR if params >= minParams + 1 (just too many regardless)
          if (params.length < minParams + 1 && !hasDuplicateTypes(params)) {
            return;
          }

          context.report({
            node,
            message: `Function has ${params.length} parameters. Consider a single props/options object.`,
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
              node.callee.type !== "MemberExpression" ||
              node.callee.object.type !== "Identifier" ||
              node.callee.object.name !== "v" ||
              node.callee.property.type !== "Identifier" ||
              node.callee.property.name !== "date"
            ) {
              return;
            }

            // Check if inside v.pipe(...) with a preceding v.transform(...)
            const parent = node.parent;
            if (parent?.type === "CallExpression" && isPipeCall(parent.callee)) {
              const args = parent.arguments;
              const dateIdx = args.indexOf(node);
              const transformIdx = args.findIndex(
                (arg) =>
                  arg.type === "CallExpression" &&
                  arg.callee.type === "MemberExpression" &&
                  arg.callee.object.type === "Identifier" &&
                  arg.callee.object.name === "v" &&
                  arg.callee.property.name === "transform",
              );

              if (transformIdx !== -1 && transformIdx < dateIdx) {
                // First arg is v.string() — we can remove transform + date, keep just isoTimestamp
                const firstArg = args[0];
                if (isVCall(firstArg, "string")) {
                  context.report({
                    node: parent,
                    message:
                      "Use v.pipe(v.string(), v.isoTimestamp()) instead of pipe with transform + date.",
                    fix(fixer) {
                      const source = context.getSourceCode();
                      // Remove transform and replace v.date() with v.isoTimestamp()
                      const fixes = [];

                      // Remove transform arg (including trailing comma/whitespace)
                      const transformNode = args[transformIdx];
                      const nextToken = source.getTokenAfter(transformNode);
                      if (nextToken && nextToken.value === ",") {
                        fixes.push(fixer.removeRange([transformNode.range[0], nextToken.range[1]]));
                      } else {
                        const prevToken = source.getTokenBefore(transformNode);
                        if (prevToken && prevToken.value === ",") {
                          fixes.push(
                            fixer.removeRange([prevToken.range[0], transformNode.range[1]]),
                          );
                        } else {
                          fixes.push(fixer.remove(transformNode));
                        }
                      }

                      // Replace v.date() with v.isoTimestamp()
                      fixes.push(fixer.replaceText(node, "v.isoTimestamp()"));

                      return fixes;
                    },
                  });
                  return;
                }

                // Non-string input (e.g. v.number()) — cannot safely auto-fix transform
                context.report({
                  node,
                  message:
                    "Use v.isoTimestamp() instead of v.date(). Update the transform to return an ISO string.",
                });
                return;
              }
            }

            // Standalone v.date() — simple replacement
            context.report({
              node,
              message:
                "Use v.isoTimestamp() instead of v.date(). Compare date strings with localeCompare().",
              fix(fixer) {
                return fixer.replaceText(node.callee.property, "isoTimestamp");
              },
            });
          },
        };

        function isPipeCall(callee) {
          return (
            callee.type === "MemberExpression" &&
            callee.object.type === "Identifier" &&
            callee.object.name === "v" &&
            callee.property.name === "pipe"
          );
        }

        //oxlint-disable-next-line beesolve/prefer-props-object
        function isVCall(node, name) {
          return (
            node?.type === "CallExpression" &&
            node.callee.type === "MemberExpression" &&
            node.callee.object.type === "Identifier" &&
            node.callee.object.name === "v" &&
            node.callee.property.name === name
          );
        }
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
        function report(node) {
          context.report({
            node: node.key,
            message: `Property "${node.key.name || node.key.value}" should be readonly.`,
          });
        }
        return {
          "TSInterfaceDeclaration TSPropertySignature[readonly=false]": report,
          "TSTypeLiteral TSPropertySignature[readonly=false]": report,
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
