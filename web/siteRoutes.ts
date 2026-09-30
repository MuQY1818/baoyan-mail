export type SitePage = "celebration" | "archive";

export function resolveSitePage(pathname: string): SitePage {
  return pathname.replace(/\/+$/, "") === "/archive" ? "archive" : "celebration";
}
