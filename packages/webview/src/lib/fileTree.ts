/** A folder of the changed-files tree (Treeline's, for any file with a path). */
export interface Dir<F extends { path: string }> {
  /** Its row label: one folder, or a chain of folders holding nothing but the next one (`a/b/c`). */
  name: string;
  path: string;
  dirs: Dir<F>[];
  files: F[];
}

/** Groups files by folder, merging chains of single folders into one row. */
export function fileTree<F extends { path: string }>(files: F[]): Dir<F> {
  const root: Dir<F> = { name: '', path: '', dirs: [], files: [] };
  for (const file of files) {
    let dir = root;
    for (const part of file.path.split('/').slice(0, -1)) {
      const path = dir.path ? `${dir.path}/${part}` : part;
      let next = dir.dirs.find((one) => one.path === path);
      if (!next) dir.dirs.push((next = { name: part, path, dirs: [], files: [] }));
      dir = next;
    }
    dir.files.push(file);
  }
  const compact = (dir: Dir<F>): Dir<F> => {
    while (dir.name && dir.dirs.length === 1 && dir.files.length === 0) {
      const [only] = dir.dirs;
      dir = { ...only, name: `${dir.name}/${only.name}` };
    }
    return { ...dir, dirs: dir.dirs.map(compact) };
  };
  return compact(root);
}

/** Every file under a folder, at any depth. */
export const filesIn = <F extends { path: string }>(dir: Dir<F>): F[] => [
  ...dir.files,
  ...dir.dirs.flatMap(filesIn)
];
