import { buildBom, cutListCsv, summaryCsv, type Project, type Topology } from "../../core";

function download(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topology";
}

/** Two CSV downloads for one topology. Throws BomBlocked while design rule errors remain. */
export function exportBom(project: Project, topology: Topology): void {
  const bom = buildBom(project, topology);
  const base = `${slug(project.file.name)}-${slug(topology.name)}`;
  download(`${base}-cut-list.csv`, cutListCsv(bom));
  download(`${base}-summary.csv`, summaryCsv(bom));
}
