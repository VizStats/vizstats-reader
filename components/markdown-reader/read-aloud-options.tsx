"use client";

import { AudioLines, ListTree } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type {
  ReadAloudController,
  ReadAloudScript,
} from "@/hooks/use-read-aloud";
import type { SpeechSection } from "@/lib/markdown/speech";
import { getCastableDeviceVoices } from "@/lib/speech/cast";
import { isNaturalSoundingVoice } from "@/lib/speech/device-voices";
import { KOKORO_VOICES } from "@/lib/speech/kokoro-messages";
import { cn } from "@/lib/utils";

export function ReadAloudOptions({
  activeSectionIndex,
  canRead,
  controlIdPrefix,
  onJumpToSection,
  reader,
  script,
  sections,
}: {
  activeSectionIndex: number;
  canRead: boolean;
  controlIdPrefix: string;
  onJumpToSection: (chunkIndex: number) => void;
  reader: ReadAloudController;
  script?: ReadAloudScript;
  sections: SpeechSection[];
}) {
  const engineControlId = `${controlIdPrefix}-engine`;
  const rateControlId = `${controlIdPrefix}-rate`;
  const voiceControlId = `${controlIdPrefix}-voice`;
  const tableReadLabelId = `${controlIdPrefix}-table-read`;
  const cast = script ? reader.getCast(script.castKey, script.speakers) : null;
  const hasCast = Boolean(cast && cast.characters.length > 0);
  const isTableRead = hasCast && reader.tableRead;

  return (
    <>
      <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
        <label
          className="text-xs font-medium text-muted-foreground"
          htmlFor={rateControlId}
        >
          Speed
        </label>
        <input
          aria-label="Reading speed"
          className="h-1.5 w-20 accent-[#03444A] dark:accent-[#58D1E2]"
          disabled={!canRead}
          id={rateControlId}
          max="1.5"
          min="0.75"
          onChange={(event) =>
            reader.setRate(Number(event.currentTarget.value))
          }
          step="0.05"
          type="range"
          value={reader.rate}
        />
        <span className="w-9 text-right tabular-nums text-xs text-muted-foreground">
          {reader.rate.toFixed(2).replace(/0$/, "")}x
        </span>
      </div>

      {sections.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="Jump to section"
                className="size-7 shrink-0 rounded-full"
                disabled={!canRead}
                size="icon-sm"
                title="Jump to section"
                type="button"
                variant="ghost"
              />
            }
          >
            <ListTree aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="max-h-72 w-64 scrollbar-hide"
          >
            {sections.map((section, index) => (
              <DropdownMenuItem
                key={`${section.id}-${section.chunkIndex}`}
                className={cn(
                  index === activeSectionIndex &&
                    "font-medium text-[#03444A] dark:text-[#58D1E2]",
                )}
                onClick={() => onJumpToSection(section.chunkIndex)}
                style={{ paddingLeft: `${(section.level - 1) * 12 + 8}px` }}
              >
                <span className="min-w-0 flex-1 truncate">{section.text}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <Popover>
        <PopoverTrigger
          render={
            <Button
              aria-label="Voice settings"
              className="size-7 shrink-0 rounded-full"
              size="icon-sm"
              title="Voice settings"
              type="button"
              variant="ghost"
            />
          }
        >
          <AudioLines aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 gap-3">
          <PopoverHeader>
            <PopoverTitle>Voice settings</PopoverTitle>
            <PopoverDescription>
              Choose how the document is read aloud.
            </PopoverDescription>
          </PopoverHeader>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor={engineControlId}
            >
              Engine
            </label>
            <NativeSelect
              className="w-full"
              id={engineControlId}
              onChange={(event) =>
                reader.setEngine(
                  event.currentTarget.value === "natural"
                    ? "natural"
                    : "device",
                )
              }
              size="sm"
              value={reader.engine}
            >
              <NativeSelectOption
                disabled={!reader.deviceSupported}
                value="device"
              >
                Device voice · instant
              </NativeSelectOption>
              <NativeSelectOption
                disabled={!reader.naturalSupported}
                value="natural"
              >
                Natural AI voice · on-device
              </NativeSelectOption>
            </NativeSelect>
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor={voiceControlId}
            >
              {isTableRead ? "Narrator voice" : "Voice"}
            </label>
            {reader.engine === "device" ? (
              <NativeSelect
                className="w-full"
                id={voiceControlId}
                onChange={(event) =>
                  reader.setDeviceVoiceURI(event.currentTarget.value || null)
                }
                size="sm"
                value={reader.deviceVoiceURI ?? ""}
              >
                <NativeSelectOption value="">
                  Auto · best available
                </NativeSelectOption>
                {reader.deviceVoices.map((voice) => (
                  <NativeSelectOption
                    key={voice.voiceURI}
                    value={voice.voiceURI}
                  >
                    {voice.name} ({voice.lang})
                    {isNaturalSoundingVoice(voice) ? " ★" : ""}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <NativeSelect
                className="w-full"
                id={voiceControlId}
                onChange={(event) => {
                  const voice = KOKORO_VOICES.find(
                    (candidate) => candidate.id === event.currentTarget.value,
                  );

                  if (voice) {
                    reader.setKokoroVoice(voice.id);
                  }
                }}
                size="sm"
                value={reader.kokoroVoice}
              >
                {KOKORO_VOICES.map((voice) => (
                  <NativeSelectOption key={voice.id} value={voice.id}>
                    {voice.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </div>

          {script && cast && hasCast ? (
            <div className="flex flex-col gap-2.5 border-t border-border/70 pt-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium" id={tableReadLabelId}>
                    Table read
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Each character in their own voice; the narrator reads the
                    rest.
                  </p>
                </div>
                <Switch
                  aria-labelledby={tableReadLabelId}
                  checked={reader.tableRead}
                  onCheckedChange={(checked) => reader.setTableRead(checked)}
                />
              </div>

              {isTableRead ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">
                      Cast
                    </p>
                    <Button
                      onClick={() => reader.resetCast(script.castKey)}
                      size="xs"
                      title="Cast every character automatically again"
                      type="button"
                      variant="ghost"
                    >
                      Recast
                    </Button>
                  </div>
                  <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-muted-foreground/30">
                    {cast.characters.map((character) => (
                      <div
                        className="flex items-center gap-2"
                        key={character.name}
                      >
                        <span
                          className="min-w-0 flex-1 truncate text-xs font-medium"
                          title={character.name}
                        >
                          {character.name}
                        </span>
                        <CastVoiceSelect
                          name={character.name}
                          onChange={(voice) =>
                            reader.setCharacterVoice(
                              script.castKey,
                              character.name,
                              voice,
                            )
                          }
                          reader={reader}
                          value={cast.voices[character.name] ?? ""}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {reader.engine === "natural"
              ? "The natural voice runs entirely in your browser. The first use downloads a ~90 MB model, which is then cached — no account or API key needed."
              : "Device voices play instantly. Voices marked ★ usually sound the most natural. On macOS you can add higher-quality voices in System Settings → Accessibility → Spoken Content."}
          </p>
        </PopoverContent>
      </Popover>
    </>
  );
}

// A character's voice, from the current engine's voices. Device voices are
// limited to the narrator's language, without the novelty voices.
function CastVoiceSelect({
  name,
  onChange,
  reader,
  value,
}: {
  name: string;
  onChange: (voice: string) => void;
  reader: ReadAloudController;
  value: string;
}) {
  const deviceVoices =
    reader.engine === "device"
      ? getCastableDeviceVoices(reader.deviceVoices, reader.narratorDeviceVoice)
      : [];
  const castVoice = reader.deviceVoices.find(
    (voice) => voice.voiceURI === value,
  );

  if (castVoice && !deviceVoices.includes(castVoice)) {
    deviceVoices.unshift(castVoice);
  }

  return (
    <NativeSelect
      aria-label={`Voice for ${name}`}
      className="w-40"
      onChange={(event) => onChange(event.currentTarget.value)}
      size="sm"
      value={value}
    >
      {reader.engine === "natural"
        ? KOKORO_VOICES.map((voice) => (
            <NativeSelectOption key={voice.id} value={voice.id}>
              {voice.label}
            </NativeSelectOption>
          ))
        : deviceVoices.map((voice) => (
            <NativeSelectOption key={voice.voiceURI} value={voice.voiceURI}>
              {voice.name}
            </NativeSelectOption>
          ))}
    </NativeSelect>
  );
}
