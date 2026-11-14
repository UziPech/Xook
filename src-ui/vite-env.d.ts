/// <reference types="vite/client" />

declare module "*?icon-data" {
  interface StaticSvgIconData {
    viewBox: string;
    fillRule?: "evenodd" | "nonzero";
    paths: ReadonlyArray<{
      d: string;
      fillRule?: "evenodd" | "nonzero";
    }>;
  }

  const iconData: StaticSvgIconData;
  export default iconData;
}
