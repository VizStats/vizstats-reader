// A small XML reader for Final Draft files: elements, attributes, text,
// entities, CDATA, comments and declarations. It runs the same in the browser
// and in tests, and never fetches anything a document refers to.

export type XmlElement = {
  attributes: Record<string, string>;
  children: XmlNode[];
  name: string;
};

export type XmlNode = string | XmlElement;

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlParseError";
  }
}

const NAME = /[A-Za-z_:][\w.:-]*/y;
const ATTRIBUTE = /\s*([A-Za-z_:][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  quot: '"',
};

export function parseXml(source: string): XmlElement {
  const text = source.replace(/^﻿/, "");
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let index = 0;

  const skipPast = (marker: string) => {
    const end = text.indexOf(marker, index);

    if (end === -1) {
      throw new XmlParseError(`Unclosed ${marker} construct`);
    }

    index = end + marker.length;
  };

  const appendText = (value: string) => {
    const parent = stack.at(-1);

    if (parent && value) {
      parent.children.push(value);
    } else if (!parent && value.trim()) {
      throw new XmlParseError("Text outside the root element");
    }
  };

  while (index < text.length) {
    const next = text.indexOf("<", index);

    if (next === -1) {
      appendText(decodeEntities(text.slice(index)));
      break;
    }

    appendText(decodeEntities(text.slice(index, next)));
    index = next;

    if (text.startsWith("<!--", index)) {
      skipPast("-->");
    } else if (text.startsWith("<![CDATA[", index)) {
      const end = text.indexOf("]]>", index);

      if (end === -1) {
        throw new XmlParseError("Unclosed CDATA section");
      }

      appendText(text.slice(index + 9, end));
      index = end + 3;
    } else if (text.startsWith("<?", index)) {
      skipPast("?>");
    } else if (text.startsWith("<!", index)) {
      skipDeclaration();
    } else if (text.startsWith("</", index)) {
      index += 2;

      const name = readName();
      const open = stack.pop();

      if (!open || open.name !== name) {
        throw new XmlParseError(`Unexpected closing tag </${name}>`);
      }

      index = text.indexOf(">", index);

      if (index === -1) {
        throw new XmlParseError(`Unclosed tag </${name}>`);
      }

      index += 1;
    } else {
      index += 1;

      const element: XmlElement = {
        attributes: {},
        children: [],
        name: readName(),
      };

      for (;;) {
        ATTRIBUTE.lastIndex = index;

        const attribute = ATTRIBUTE.exec(text);

        if (!attribute) {
          break;
        }

        element.attributes[attribute[1]!] = decodeEntities(
          attribute[2] ?? attribute[3] ?? "",
        );
        index = ATTRIBUTE.lastIndex;
      }

      const close = text.slice(index).match(/^\s*(\/?)>/);

      if (!close) {
        throw new XmlParseError(`Malformed tag <${element.name}>`);
      }

      index += close[0].length;

      const parent = stack.at(-1);

      if (parent) {
        parent.children.push(element);
      } else if (root) {
        throw new XmlParseError("More than one root element");
      } else {
        root = element;
      }

      if (!close[1]) {
        stack.push(element);
      }
    }
  }

  if (!root) {
    throw new XmlParseError("No root element");
  }

  if (stack.length > 0) {
    throw new XmlParseError(`Unclosed tag <${stack.at(-1)!.name}>`);
  }

  return root;

  function readName() {
    NAME.lastIndex = index;

    const match = NAME.exec(text);

    if (!match) {
      throw new XmlParseError("Expected a tag name");
    }

    index = NAME.lastIndex;

    return match[0];
  }

  // <!DOCTYPE …>, including an internal subset in square brackets.
  function skipDeclaration() {
    let depth = 0;

    for (; index < text.length; index += 1) {
      const char = text[index];

      if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        depth -= 1;
      } else if (char === ">" && depth <= 0) {
        index += 1;
        return;
      }
    }

    throw new XmlParseError("Unclosed declaration");
  }
}

export function getChildElements(element: XmlElement, name?: string) {
  return element.children.filter(
    (child): child is XmlElement =>
      typeof child !== "string" && (name === undefined || child.name === name),
  );
}

export function getChildElement(element: XmlElement, name: string) {
  return getChildElements(element, name)[0];
}

export function getTextContent(element: XmlElement): string {
  return element.children
    .map((child) => (typeof child === "string" ? child : getTextContent(child)))
    .join("");
}

function decodeEntities(value: string) {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, body: string) => {
      if (body.startsWith("#")) {
        const codePoint =
          body[1] === "x" || body[1] === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);

        return codePoint > 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }

      return NAMED_ENTITIES[body] ?? entity;
    },
  );
}
