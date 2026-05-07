import { describe, expect, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { ExtensionsArticle } from "../Article";
import type { InitialAnnotationsByExtension } from "../types";

describe("ExtensionsArticle", () => {
  it("keeps quote highlights when an extension annotates the same text", async () => {
    const annotations: InitialAnnotationsByExtension = {
      "fact-check": {
        ranAt: 1,
        annotations: [
          {
            id: "claim-1",
            index: 1,
            spanText: "shared quote",
            tone: "neutral",
            title: "Claim 1",
            body: "Needs review.",
            linkUrl: null,
            linkTitle: null,
          },
        ],
      },
    };

    const { container } = render(
      <ExtensionsArticle
        draftId="draft-overlapping-quote"
        bodyHtml="<p>He said shared quote lands today.</p>"
        initialAnnotationsByExt={annotations}
        enabledExtensionIds={["fact-check"]}
        quotes={[{ text: "shared quote", citation: "https://example.com/source" }]}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('mark[data-fp-quote="1"]')).toBeInTheDocument();
      expect(container.querySelector('mark[data-fp-ext="fact-check"]')).toBeInTheDocument();
    });
  });

  it("matches a quote even when smart quotes and apostrophes drift between JSON and body", async () => {
    const { container } = render(
      <ExtensionsArticle
        draftId="draft-smart-quotes"
        bodyHtml={`<p>The CEO said “it’s a fundraise round” before the call dropped.</p>`}
        initialAnnotationsByExt={{}}
        enabledExtensionIds={[]}
        quotes={[{ text: "it's a fundraise round", citation: "https://example.com/source" }]}
      />,
    );

    await waitFor(() => {
      const mark = container.querySelector('mark[data-fp-quote="1"]');
      expect(mark).toBeInTheDocument();
      expect(mark?.textContent).toBe("it’s a fundraise round");
    });
  });
});
