import { Button } from "@/components/ui/button";
import { SCRIPTING_DOCS_URL } from "@/lib/python/scripting-docs-url";

// The persistent "How to write a script" link in the scripting tools (band
// weighting, band selection, custom transform). It opens the hosted guide in
// the default browser: target="_blank" routes through the main process
// setWindowOpenHandler, which hands the URL to shell.openExternal (CT-218).
export function ScriptDocsLink(): JSX.Element {
  return (
    <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
      <a href={SCRIPTING_DOCS_URL} target="_blank" rel="noreferrer">
        How to write a script
      </a>
    </Button>
  );
}
