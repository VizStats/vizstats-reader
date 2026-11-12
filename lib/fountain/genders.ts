import { getFountainPlainText } from "@/lib/fountain/inline";
import { getSpeakerName } from "@/lib/fountain/model";
import type { DialogueBlock, Screenplay } from "@/lib/fountain/parse";
import type { CharacterGender } from "@/lib/speech/cast";

// Reads each speaking character's gender from the script itself, so the
// table read can cast a matching voice: words in the cue ("OLD WOMAN",
// "MRS. HALE"), the description that introduces them ("JUNE (40s), a
// retired pilot") and the pronouns the action uses after their name.
// Characters the script never genders are left out and cast from any voice.

type Votes = { female: number; male: number };

const FEMALE_WORDS = new Set([
  "actress",
  "aunt",
  "aunty",
  "auntie",
  "baroness",
  "bride",
  "businesswoman",
  "chairwoman",
  "countess",
  "daughter",
  "duchess",
  "empress",
  "girl",
  "girlfriend",
  "gran",
  "grandma",
  "grandmother",
  "granny",
  "heiress",
  "hostess",
  "lady",
  "landlady",
  "madam",
  "maid",
  "mama",
  "mistress",
  "mom",
  "mommy",
  "mother",
  "mrs",
  "ms",
  "mum",
  "mummy",
  "niece",
  "nun",
  "policewoman",
  "princess",
  "queen",
  "sister",
  "stepmother",
  "stewardess",
  "waitress",
  "widow",
  "wife",
  "woman",
  "women",
]);

const MALE_WORDS = new Set([
  "boy",
  "boyfriend",
  "brother",
  "businessman",
  "chairman",
  "dad",
  "daddy",
  "duke",
  "emperor",
  "father",
  "fireman",
  "gentleman",
  "grandfather",
  "grandpa",
  "groom",
  "guy",
  "husband",
  "king",
  "landlord",
  "lord",
  "man",
  "men",
  "monk",
  "mr",
  "nephew",
  "papa",
  "policeman",
  "priest",
  "prince",
  "sir",
  "son",
  "stepfather",
  "uncle",
  "waiter",
  "widower",
]);

// Subject pronouns follow a name most reliably; object and possessive ones
// often belong to someone else in the sentence.
const PRONOUN_WEIGHTS = new Map<string, [CharacterGender, number]>([
  ["he", ["male", 2]],
  ["she", ["female", 2]],
  ["himself", ["male", 2]],
  ["herself", ["female", 2]],
  ["his", ["male", 1]],
  ["him", ["male", 1]],
  ["her", ["female", 1]],
  ["hers", ["female", 1]],
]);

const NAME_WORD_WEIGHT = 6;
const DESCRIPTION_WEIGHT = 3;

export function getCharacterGenders(
  screenplay: Screenplay,
): Record<string, CharacterGender> {
  const names = getSpeakingNames(screenplay);
  const votes = new Map<string, Votes>(
    names.map((name) => [name, { female: 0, male: 0 }]),
  );

  for (const name of names) {
    for (const word of getWords(name)) {
      const gender = getWordGender(word);

      if (gender) {
        votes.get(name)![gender] += NAME_WORD_WEIGHT;
      }
    }
  }

  const matchers = names.map((name) => ({
    name,
    pattern: getNamePattern(name),
  }));

  for (const element of screenplay.elements) {
    if (element.type === "action") {
      addActionVotes(getFountainPlainText(element.text), matchers, votes);
    }
  }

  const genders: Record<string, CharacterGender> = {};

  for (const [name, { female, male }] of votes) {
    if (female >= 1 && female >= male * 1.5 + 1) {
      genders[name] = "female";
    } else if (male >= 1 && male >= female * 1.5 + 1) {
      genders[name] = "male";
    }
  }

  return genders;
}

function getSpeakingNames(screenplay: Screenplay) {
  const names = new Set<string>();
  const add = (block: DialogueBlock) => {
    const name = getSpeakerName(block.character);

    if (name) {
      names.add(name);
    }
  };

  for (const element of screenplay.elements) {
    if (element.type === "dialogue") {
      add(element);
    } else if (element.type === "dual-dialogue") {
      add(element.left);
      add(element.right);
    }
  }

  return Array.from(names);
}

// Each mention of a character in action owns the text up to the next
// mention, at most to the end of the following sentence: "JUNE (40s), a
// retired pilot, checks her watch. She is late." Pronouns there are theirs.
function addActionVotes(
  text: string,
  matchers: { name: string; pattern: RegExp }[],
  votes: Map<string, Votes>,
) {
  const mentions: { end: number; name: string; start: number }[] = [];

  for (const { name, pattern } of matchers) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[1]!.length;

      mentions.push({ end: start + match[2]!.length, name, start });
    }
  }

  // Where names overlap ("MARY" inside "MARY JANE"), the longer one wins.
  mentions.sort((a, b) => a.start - b.start || b.end - a.end);

  const distinct = mentions.filter(
    (mention, index) =>
      index === 0 || mention.start >= mentions[index - 1]!.end,
  );

  distinct.forEach((mention, index) => {
    const next = distinct[index + 1];
    const window = limitToNextSentence(
      text.slice(mention.end, next ? next.start : text.length),
    );
    const tally = votes.get(mention.name)!;
    const description = getDescriptionGender(window);

    if (description) {
      tally[description] += DESCRIPTION_WEIGHT;
    }

    for (const word of getWords(window)) {
      const pronoun = PRONOUN_WEIGHTS.get(word);

      if (pronoun) {
        tally[pronoun[0]] += pronoun[1];
        break;
      }
    }
  });
}

// The introduction's description: "(40s), a retired pilot" or ", an old
// man in a cap". Only the first few words, before any other clause.
function getDescriptionGender(window: string) {
  const description = window.match(
    /^\s*(?:\([^)]*\)\s*)?,\s*(?:\([^)]*\)\s*,?\s*)?(?:an?|the)\s+([^,.;:!?()]*)/i,
  )?.[1];

  if (!description) {
    return undefined;
  }

  for (const word of getWords(description).slice(0, 5)) {
    const gender = getWordGender(word);

    if (gender) {
      return gender;
    }
  }

  return undefined;
}

function limitToNextSentence(text: string) {
  const ends = [...text.matchAll(/[.!?]+(?=\s|$)/g)];
  const cut = ends[1];

  return cut ? text.slice(0, cut.index + cut[0].length) : text;
}

function getWordGender(word: string): CharacterGender | undefined {
  if (FEMALE_WORDS.has(word)) {
    return "female";
  }

  if (MALE_WORDS.has(word)) {
    return "male";
  }

  // POLICEWOMAN, FISHERMAN, DOORMAN.
  if (/.{3,}wom[ae]n$/.test(word)) {
    return "female";
  }

  if (/.{3,}(?<!sha|ger|cay|lis)m[ae]n$/.test(word)) {
    return "male";
  }

  return undefined;
}

function getWords(text: string) {
  return text.toLowerCase().match(/\p{L}+/gu) ?? [];
}

// A name in action is in capitals when introduced and in title case after:
// "WILL" or "Will", never the verb "will".
function getNamePattern(name: string) {
  const titleCase = name
    .toLowerCase()
    .replace(/(^|[\s'.-])(\p{L})/gu, (_, boundary: string, letter: string) =>
      `${boundary}${letter.toUpperCase()}`,
    );
  const variants = Array.from(new Set([name, titleCase])).map(escapeRegExp);

  return new RegExp(
    `(^|[^\\p{L}\\p{N}])(${variants.join("|")})(?![\\p{L}\\p{N}])`,
    "gu",
  );
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
