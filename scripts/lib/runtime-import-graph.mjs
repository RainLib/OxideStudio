import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export function listTypeScriptModules(root, directory) {
  return fs
    .readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return listTypeScriptModules(root, file);
      return /\.tsx?$/.test(file) && !/\.(test|spec|d)\.tsx?$/.test(file)
        ? [file]
        : [];
    });
}

function resolveLocal(root, importer, specifier) {
  const base = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(root, path.dirname(importer), specifier)
      : null;
  if (!base) return null;
  // NodeNext TypeScript imports retain .js specifiers in source.
  const sourceBase = /\.jsx?$/.test(base) ? base.replace(/\.jsx?$/, "") : null;
  for (const candidate of [
    ...(sourceBase ? [`${sourceBase}.ts`, `${sourceBase}.tsx`] : []),
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (
      /\.(tsx?|jsx?)$/.test(candidate) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      return path.relative(root, candidate);
    }
  }
  return null;
}

/** Inspect emitted imports; erased type references are not runtime edges. */
export function readRuntimeImports(
  root,
  file,
  { includeDynamic = false } = {},
) {
  const { outputText } = ts.transpileModule(
    fs.readFileSync(path.join(root, file), "utf8"),
    {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const source = ts.createSourceFile(
    file,
    outputText,
    ts.ScriptTarget.Latest,
    true,
  );
  const imports = [];
  function add(specifier) {
    if (!specifier || !ts.isStringLiteralLike(specifier)) {
      throw new Error(`${file}: runtime imports must have a literal path.`);
    }
    imports.push({
      specifier: specifier.text,
      resolved: resolveLocal(root, file, specifier.text),
    });
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      add(node.moduleSpecifier);
    } else if (
      includeDynamic &&
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports;
}

export function assertAcyclic(graph, label) {
  const active = [];
  const done = new Set();
  function check(file) {
    const previous = active.indexOf(file);
    if (previous >= 0)
      throw new Error(
        `${label} dependency cycle: ${[...active.slice(previous), file].join(" -> ")}`,
      );
    if (done.has(file)) return;
    active.push(file);
    graph.get(file)?.forEach(check);
    active.pop();
    done.add(file);
  }
  graph.forEach((_, file) => check(file));
}
