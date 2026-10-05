/* occt-import-js ships no types. */
declare module "occt-import-js" {
  interface Occt {
    ReadStepFile(content: Uint8Array, params: Record<string, unknown> | null): unknown;
  }
  export default function occtimportjs(options?: { locateFile?: (name: string) => string }): Promise<Occt>;
}
