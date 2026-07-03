import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  SCRIPT_DOCS_INTRO,
  SCRIPT_DOCS_SECTIONS,
  SCRIPT_DOCS_TITLE,
  type ScriptDocsSection,
  type ScriptDocsWorkedExample,
} from "@/lib/python/script-docs-content";
import { useScriptDocsPage } from "@/state/script-docs-context";

export function ScriptDocsDialog(): JSX.Element {
  const { isScriptDocsPageOpen, setScriptDocsPageOpen } = useScriptDocsPage();
  return (
    <Dialog open={isScriptDocsPageOpen} onOpenChange={setScriptDocsPageOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{SCRIPT_DOCS_TITLE}</DialogTitle>
          <DialogDescription>{SCRIPT_DOCS_INTRO}</DialogDescription>
        </DialogHeader>
        <ScriptDocsSectionList />
      </DialogContent>
    </Dialog>
  );
}

function ScriptDocsSectionList(): JSX.Element {
  return (
    <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
      {SCRIPT_DOCS_SECTIONS.map((section) => (
        <ScriptDocsSectionBlock key={section.id} section={section} />
      ))}
    </div>
  );
}

function ScriptDocsSectionBlock({ section }: { section: ScriptDocsSection }): JSX.Element {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{section.heading}</h3>
      {section.paragraphs.map(renderDocsParagraph)}
      <ScriptDocsBulletList bullets={section.bullets} />
      <ScriptDocsExampleBlock example={section.example} />
    </section>
  );
}

function renderDocsParagraph(paragraph: string, index: number): JSX.Element {
  return (
    <p key={index} className="text-sm text-muted-foreground">
      {paragraph}
    </p>
  );
}

function ScriptDocsBulletList({
  bullets,
}: {
  bullets?: readonly string[];
}): JSX.Element | null {
  if (!bullets || bullets.length === 0) return null;
  return (
    <ul className="ml-4 list-disc space-y-1 text-sm text-muted-foreground">
      {bullets.map((bullet, index) => (
        <li key={index}>{bullet}</li>
      ))}
    </ul>
  );
}

function ScriptDocsExampleBlock({
  example,
}: {
  example?: ScriptDocsWorkedExample;
}): JSX.Element | null {
  if (!example) return null;
  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted-foreground">{example.caption}</figcaption>
      <pre className="overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs leading-relaxed">
        {example.code}
      </pre>
    </figure>
  );
}
