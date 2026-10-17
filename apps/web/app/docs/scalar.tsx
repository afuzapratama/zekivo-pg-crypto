"use client";
import { useMemo } from "react";
import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
export default function Scalar({ content }: { content: string }) {
  const configuration = useMemo(
    () => ({
      content,
      theme: "none" as const,
      layout: "modern" as const,
      showSidebar: true,
      darkMode: false,
      hideDarkModeToggle: true,
      withDefaultFonts: false,
      persistAuth: false,
      telemetry: false,
      proxyUrl: "",
      showDeveloperTools: "never" as const,
      showToolbar: "never" as const,
      mcp: { disabled: true },
      agent: { disabled: true },
    }),
    [content],
  );
  return <ApiReferenceReact configuration={configuration} />;
}
