import { describe, expect, it } from "vitest";

import {
  getChildElements,
  getTextContent,
  parseXml,
  XmlParseError,
} from "@/lib/fountain/xml";

describe("parseXml", () => {
  it("reads elements, attributes, entities, CDATA and comments", () => {
    const root = parseXml(`﻿<?xml version="1.0"?>
<!DOCTYPE script [ <!ENTITY x "y"> ]>
<!-- a comment -->
<Root kind='script' title="A &amp; B">
  <Text Style="Bold">Fish &lt;&#38;&gt; chips &#x2014; &quot;now&quot;</Text>
  <Empty/>
  <Text><![CDATA[<raw> & ready]]></Text>
</Root>`);

    expect(root.name).toBe("Root");
    expect(root.attributes).toEqual({ kind: "script", title: "A & B" });
    expect(getChildElements(root).map((child) => child.name)).toEqual([
      "Text",
      "Empty",
      "Text",
    ]);
    expect(getChildElements(root, "Text").map(getTextContent)).toEqual([
      'Fish <&> chips — "now"',
      "<raw> & ready",
    ]);
  });

  it("rejects malformed documents", () => {
    for (const source of [
      "",
      "plain text",
      "<a><b></a>",
      "<a>",
      "<a></a><b></b>",
      "<a",
      "<a><!-- open</a>",
    ]) {
      expect(() => parseXml(source)).toThrow(XmlParseError);
    }
  });
});
