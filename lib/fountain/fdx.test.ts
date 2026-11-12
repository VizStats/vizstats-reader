import { describe, expect, it } from "vitest";

import {
  convertFinalDraftToFountain,
  FinalDraftImportError,
  hasFinalDraftExtension,
} from "@/lib/fountain/fdx";
import { parseFountain } from "@/lib/fountain/parse";

function fdx(content: string, extra = "") {
  return `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>${content}</Content>
  ${extra}
</FinalDraft>`;
}

function paragraph(type: string, text: string, attributes = "") {
  return `<Paragraph Type="${type}"${attributes}><Text>${text}</Text></Paragraph>`;
}

describe("convertFinalDraftToFountain", () => {
  it("converts a Final Draft script into Fountain the parser reads back", () => {
    const fountain = convertFinalDraftToFountain(
      fdx(
        [
          paragraph("Scene Heading", "int. hangar - night", ' Number="12A"'),
          paragraph("Action", "June checks her watch."),
          paragraph("Character", "june"),
          paragraph("Parenthetical", "quietly"),
          paragraph("Dialogue", "You kept her flying."),
          paragraph("Transition", "cut to:"),
          paragraph("Scene Heading", "flashback - the runway"),
          paragraph("Character", "OTTO (V.O.)"),
          paragraph("Dialogue", "Somebody had to."),
          paragraph("Transition", "FADE OUT."),
        ].join(""),
      ),
    );

    expect(fountain).toBe(`INT. HANGAR - NIGHT #12A#

June checks her watch.

JUNE
(quietly)
You kept her flying.

CUT TO:

.FLASHBACK - THE RUNWAY

OTTO (V.O.)
Somebody had to.

> FADE OUT.
`);
    expect(parseFountain(fountain).elements.map((e) => e.type)).toEqual([
      "scene-heading",
      "action",
      "dialogue",
      "transition",
      "scene-heading",
      "dialogue",
      "transition",
    ]);
  });

  it("follows the script's element settings for capitals, centering and new pages", () => {
    const fountain = convertFinalDraftToFountain(
      fdx(
        [
          paragraph("Character", "McCLANE"),
          paragraph("Dialogue", "Yippee."),
          paragraph("New Act", "act two"),
          paragraph("Action", "THE END", ' Alignment="Center"'),
        ].join(""),
        `<ElementSettings Type="Character">
          <FontSpec Style=""/><ParagraphSpec Alignment="Left" StartsNewPage="No"/>
        </ElementSettings>
        <ElementSettings Type="New Act">
          <FontSpec Style="Underline+AllCaps"/><ParagraphSpec Alignment="Center" StartsNewPage="Yes"/>
        </ElementSettings>`,
      ),
    );

    expect(fountain).toBe(`@McCLANE
Yippee.

===

> ACT TWO <

> THE END <
`);
  });

  it("keeps bold, italic and underline, and escapes Fountain's own markup", () => {
    const fountain = convertFinalDraftToFountain(
      fdx(
        `<Paragraph Type="Action">
          <Text>She reads </Text><Text Style="Bold+Underline">THE LETTER </Text><Text Style="Italic">twice</Text><Text>. Note_1 costs *5.</Text>
        </Paragraph>`,
      ),
    );

    expect(fountain).toBe(
      "She reads **_THE LETTER_** *twice*. Note\\_1 costs \\*5.\n",
    );
  });

  it("forces action that Fountain would read as another element", () => {
    const fountain = convertFinalDraftToFountain(
      fdx(
        [
          paragraph("Action", "Note: the van is blue."),
          paragraph("Action", "INT. is painted on the door."),
          paragraph("Action", "SMASH TO:"),
          paragraph("Action", "BANG\n...and silence.\n> nothing"),
          paragraph("Action", "!"),
          paragraph("Character", "RAY"),
        ].join(""),
      ),
    );

    expect(fountain).toBe(`!Note: the van is blue.

!INT. is painted on the door.

!SMASH TO:

!BANG
...and silence.
!> nothing

!!

RAY
`);
    expect(
      parseFountain(fountain).elements.every((e) => e.type === "action"),
    ).toBe(true);
  });

  it("marks the second speaker of dual dialogue", () => {
    const fountain = convertFinalDraftToFountain(
      fdx(`<Paragraph><DualDialogue>
        ${paragraph("Character", "BRICK")}${paragraph("Dialogue", "Left.")}
        ${paragraph("Character", "STEEL")}${paragraph("Dialogue", "Right.")}
      </DualDialogue></Paragraph>`),
    );

    expect(fountain).toBe("BRICK\nLeft.\n\nSTEEL ^\nRight.\n");
    expect(parseFountain(fountain).elements[0]?.type).toBe("dual-dialogue");
  });

  it("turns scene summaries into synopses and skips empty paragraphs", () => {
    const fountain = convertFinalDraftToFountain(
      fdx(`<Paragraph Type="Scene Heading">
          <SceneProperties Length="1/8" Page="1" Title="">
            <Summary><Paragraph><Text>June finds the plane.</Text></Paragraph></Summary>
          </SceneProperties>
          <Text>EXT. RUNWAY - DAY</Text>
        </Paragraph>
        ${paragraph("Action", "")}
        ${paragraph("Action", "Wind &amp; dust &#8212; then nothing.")}`),
    );

    expect(fountain).toBe(
      "EXT. RUNWAY - DAY\n\n= June finds the plane.\n\nWind & dust — then nothing.\n",
    );
  });

  it("keys the title page by its layout", () => {
    const center = (text: string) =>
      `<Paragraph Alignment="Center" Type="Action"><Text>${text}</Text></Paragraph>`;
    const fountain = convertFinalDraftToFountain(
      fdx(
        paragraph("Scene Heading", "INT. HANGAR - NIGHT"),
        `<TitlePage><Content>
          ${center("")}${center("STAND BY ME")}${center("")}
          ${center("Written by")}${center("Jane Doe")}${center("&amp; John Roe")}${center("")}
          ${center("Based on the novella")}${center("by Stephen Lake")}${center("")}
          ${center("Draft 2 -- 4 November 2026")}
          <Paragraph Alignment="Left" Type="Action"><Text>jane@example.com</Text></Paragraph>
          <Paragraph Alignment="Left" Type="Action"><Text>555 0100</Text></Paragraph>
        </Content></TitlePage>`,
      ),
    );

    expect(fountain).toBe(`Title: STAND BY ME
Credit: Written by
Author:
    Jane Doe
    & John Roe
Source:
    Based on the novella
    by Stephen Lake
Draft date: Draft 2 -- 4 November 2026
Contact:
    jane@example.com
    555 0100

INT. HANGAR - NIGHT
`);

    const { titlePage } = parseFountain(fountain);

    expect(titlePage.map((entry) => [entry.key, entry.values])).toEqual([
      ["Title", ["STAND BY ME"]],
      ["Credit", ["Written by"]],
      ["Author", ["Jane Doe", "& John Roe"]],
      ["Source", ["Based on the novella", "by Stephen Lake"]],
      ["Draft date", ["Draft 2 -- 4 November 2026"]],
      ["Contact", ["jane@example.com", "555 0100"]],
    ]);
  });

  it("splits a credit and name on one line", () => {
    const fountain = convertFinalDraftToFountain(
      fdx(
        paragraph("Action", "Dawn."),
        `<TitlePage><Content>
          <Paragraph Alignment="Center"><Text>LOW TIDE</Text></Paragraph>
          <Paragraph Alignment="Center"><Text></Text></Paragraph>
          <Paragraph Alignment="Center"><Text>Written by Ada Obi</Text></Paragraph>
          <Paragraph Alignment="Right"><Text>Revised 11/04/26</Text></Paragraph>
        </Content></TitlePage>`,
      ),
    );

    expect(fountain.split("\n\n")[0]).toBe(
      "Title: LOW TIDE\nCredit: Written by\nAuthor: Ada Obi\nDraft date: Revised 11/04/26",
    );
  });

  it("rejects files that are not Final Draft scripts", () => {
    expect(() => convertFinalDraftToFountain("<FinalDraft><Content>")).toThrow(
      FinalDraftImportError,
    );
    expect(() =>
      convertFinalDraftToFountain("<svg><Content/></svg>"),
    ).toThrow(FinalDraftImportError);
    expect(() =>
      convertFinalDraftToFountain(fdx(paragraph("Action", " "))),
    ).toThrow(FinalDraftImportError);
  });
});

describe("hasFinalDraftExtension", () => {
  it("matches .fdx in any case", () => {
    expect(hasFinalDraftExtension("Low Tide.FDX")).toBe(true);
    expect(hasFinalDraftExtension("low-tide.fountain")).toBe(false);
  });
});
