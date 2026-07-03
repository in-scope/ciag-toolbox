import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Holds the open state of the "How to write a custom script" page (CT-208f) so the
// consuming tools (CT-209 band weighting, CT-210 band selection) can open it from a
// persistent "How to write a script" link, and the View menu can open it too.

export interface ScriptDocsPageApi {
  readonly isScriptDocsPageOpen: boolean;
  readonly setScriptDocsPageOpen: (open: boolean) => void;
  readonly openScriptDocsPage: () => void;
}

const ScriptDocsPageContext = createContext<ScriptDocsPageApi | null>(null);

interface ScriptDocsProviderProps {
  children: ReactNode;
}

export function ScriptDocsProvider(props: ScriptDocsProviderProps): JSX.Element {
  const [isScriptDocsPageOpen, setScriptDocsPageOpen] = useState(false);
  const openScriptDocsPage = useCallback(() => setScriptDocsPageOpen(true), []);
  useScriptDocsMenuOpensPage(openScriptDocsPage);
  const api = useMemo<ScriptDocsPageApi>(
    () => ({ isScriptDocsPageOpen, setScriptDocsPageOpen, openScriptDocsPage }),
    [isScriptDocsPageOpen, openScriptDocsPage],
  );
  return (
    <ScriptDocsPageContext.Provider value={api}>
      {props.children}
    </ScriptDocsPageContext.Provider>
  );
}

function useScriptDocsMenuOpensPage(openScriptDocsPage: () => void): void {
  useEffect(
    () => window.toolboxApi.onMenuScriptDocs(openScriptDocsPage),
    [openScriptDocsPage],
  );
}

export function useScriptDocsPage(): ScriptDocsPageApi {
  const api = useContext(ScriptDocsPageContext);
  if (!api) {
    throw new Error("useScriptDocsPage must be used inside a ScriptDocsProvider");
  }
  return api;
}
