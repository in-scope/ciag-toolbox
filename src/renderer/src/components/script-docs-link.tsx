import { Button } from "@/components/ui/button";
import { useScriptDocsPage } from "@/state/script-docs-context";

// The persistent "How to write a script" link the scripting tools (CT-209 band
// weighting, CT-210 band selection) point at the CT-208f docs page.
export function ScriptDocsLink(): JSX.Element {
  const { openScriptDocsPage } = useScriptDocsPage();
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className="h-auto p-0 text-xs"
      onClick={openScriptDocsPage}
    >
      How to write a script
    </Button>
  );
}
