import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "@monaco-editor",
  "react",
);

const patches = {
  "dist/index.mjs": [
    {
      name: "Editor lifecycle",
      original:
        "function pe(){I.current?.dispose(),V?y&&_.set(m,o.current.saveViewState()):o.current.getModel()?.dispose(),o.current.dispose()}",
      replacement:
        "function pe(){I.current?.dispose(),V?y&&_.set(m,o.current.saveViewState()):o.current.getModel()?.dispose(),o.current.dispose(),o.current=null,Q.current=!1,u(!1)}",
    },
    {
      name: "DiffEditor lifecycle",
      original:
        "function I(){let i=u.current?.getModel();g||i?.original?.dispose(),N||i?.modified?.dispose(),u.current?.dispose()}",
      replacement:
        "function I(){let i=u.current?.getModel();g||i?.original?.dispose(),N||i?.modified?.dispose(),u.current?.dispose(),u.current=null,b.current=!1,O(!1)}",
    },
  ],
  "dist/index.js": [
    {
      name: "Editor lifecycle",
      original:
        "function he(){P.current?.dispose(),A?C&&F.set(E,n.current.saveViewState()):n.current.getModel()?.dispose(),n.current.dispose()}",
      replacement:
        "function he(){P.current?.dispose(),A?C&&F.set(E,n.current.saveViewState()):n.current.getModel()?.dispose(),n.current.dispose(),n.current=null,ee.current=!1,p(!1)}",
    },
    {
      name: "DiffEditor lifecycle",
      original:
        "function P(){let i=p.current?.getModel();R||i?.original?.dispose(),j||i?.modified?.dispose(),p.current?.dispose()}",
      replacement:
        "function P(){let i=p.current?.getModel();R||i?.original?.dispose(),j||i?.modified?.dispose(),p.current?.dispose(),p.current=null,S.current=!1,T(!1)}",
    },
  ],
};

export function patchMonacoReactSource(source, filePatches) {
  let patched = source;
  for (const patch of filePatches) {
    if (patched.includes(patch.replacement)) continue;
    if (!patched.includes(patch.original)) {
      throw new Error(
        `${patch.name} patch target was not found. Review the installed @monaco-editor/react version before continuing.`,
      );
    }
    patched = patched.replace(patch.original, patch.replacement);
  }
  return patched;
}

export async function patchInstalledMonacoReact() {
  for (const [relativePath, filePatches] of Object.entries(patches)) {
    const target = join(packageRoot, relativePath);
    const source = await readFile(target, "utf8");
    const patched = patchMonacoReactSource(source, filePatches);
    if (patched !== source) {
      await writeFile(target, patched, "utf8");
      console.log(`[postinstall] Patched Monaco lifecycle in ${relativePath}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await patchInstalledMonacoReact();
}
