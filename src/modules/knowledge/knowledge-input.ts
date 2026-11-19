import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import z from 'zod';

export const MAX_KNOWLEDGE_CHUNKS = 512;
export const MARKDOWN_TYPE = 'text/markdown; charset=utf-8';

export const jobSnapshot = z
  .object({
    version: z.number().int().positive(),
    checksum: z.string().regex(/^[0-9a-f]{64}$/),
    model: z.string().max(180),
    dimensions: z.number().int().min(1).max(4096),
    target: z.number().int().min(200).max(4000),
    overlap: z.number().int().min(0).max(500),
    batchSize: z.number().int().min(1).max(16),
    timeoutMs: z.number().int().min(1000).max(60000),
  })
  .refine((data) => data.overlap < data.target);

export const checksum = (buffer: Buffer) =>
  createHash('sha256').update(buffer).digest('hex');

export function decodeMarkdown(bytes: Buffer) {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new BadRequestException('El Markdown debe usar UTF-8 valido');
  }
  // Allow whitespace used in Markdown, but reject binary control characters.
  if (
    !text.trim() ||
    Array.from(text).some((char) => {
      const code = char.charCodeAt(0);
      return (
        (code < 32 && code !== 9 && code !== 10 && code !== 13) ||
        (code >= 127 && code <= 159)
      );
    }) ||
    /^\s*%PDF-/.test(text)
  ) {
    throw new BadRequestException('El archivo debe contener texto Markdown');
  }
  return text.replace(/\r\n?/g, '\n');
}

export function markdownChunks(text: string, target: number, overlap: number) {
  const chunks: { content: string; section: string[] }[] = [];
  const headings: { level: number; label: string }[] = [];
  let lines: string[] = [];
  let fence: string | undefined;

  const flush = () => {
    const chars = Array.from(lines.join('\n').trim());
    const section = headings.map(({ label }) => label);
    lines = [];
    for (let start = 0; start < chars.length;) {
      let end = Math.min(start + target, chars.length);
      if (end < chars.length) {
        // Prefer the end of a paragraph, then the end of a word.
        const floor = Math.max(
          start + Math.floor(target / 2),
          start + overlap + 1,
        );
        const paragraph = chars.slice(floor, end).join('').lastIndexOf('\n\n');
        if (paragraph >= 0) {
          end =
            floor +
            Array.from(
              chars
                .slice(floor, end)
                .join('')
                .slice(0, paragraph + 2),
            ).length;
        } else {
          while (end > floor && !/\s/.test(chars[end - 1])) end--;
          if (end <= floor) end = Math.min(start + target, chars.length);
        }
      }
      const content = chars.slice(start, end).join('').trim();
      if (content) {
        chunks.push({ content, section });
        if (chunks.length > MAX_KNOWLEDGE_CHUNKS)
          throw new BadRequestException(
            'El Markdown excede el limite de fragmentos',
          );
      }
      if (end === chars.length) break;
      start = end - overlap;
    }
  };

  for (const line of text.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (
        marker[1][0] === fence[0] &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = undefined;
      lines.push(line);
      continue;
    }
    const heading = !fence && /^ {0,3}(#{1,6})\s+(.{1,250})$/.exec(line);
    if (!heading) {
      lines.push(line);
      continue;
    }
    flush();
    const level = heading[1].length;
    while (headings.length && headings[headings.length - 1].level >= level)
      headings.pop();
    headings.push({ level, label: heading[2].trim() });
    lines.push(line);
  }
  flush();
  return chunks;
}

export function validVector(
  vector: unknown,
  dimensions: number,
): vector is number[] {
  return (
    Array.isArray(vector) &&
    vector.length === dimensions &&
    vector.every(
      (value: unknown) =>
        typeof value === 'number' && Number.isFinite(Math.fround(value)),
    ) &&
    vector.some((value: number) => Math.fround(value) !== 0)
  );
}
