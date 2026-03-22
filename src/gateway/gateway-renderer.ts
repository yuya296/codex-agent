import { existsSync } from 'node:fs';
import { extname } from 'node:path';

const SLACK_LOADING_MESSAGE_MAX_LENGTH = 50;
const LOCAL_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

export function toSlackLoadingMessage(message: string): string {
  const singleLine = message.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= SLACK_LOADING_MESSAGE_MAX_LENGTH) {
    return singleLine || 'thinking...';
  }

  return `${singleLine.slice(0, SLACK_LOADING_MESSAGE_MAX_LENGTH - 1).trimEnd()}…`;
}

export function toSlackMrkdwn(message: string): string {
  return renderSlackText(message);
}

export function renderSlackCompletedMessage(message: string): {
  text: string;
  images: Array<{ path: string; alt_text?: string }>;
} {
  const extracted = extractLocalImageFiles(message);
  const renderedText = toSlackMrkdwn(extracted.text).trim();

  return {
    text: renderedText || (extracted.images.length === 0 ? message : ''),
    images: extracted.images,
  };
}

export function extractLocalImageFiles(message: string): {
  text: string;
  images: Array<{ path: string; alt_text?: string }>;
} {
  const images = new Map<string, { path: string; alt_text?: string }>();
  let text = message;

  text = text.replace(/!\[([^\]]*)\]\((\/[^)\s]+\.(?:png|jpe?g|gif|webp))\)/giu, (match, alt, path) => {
    registerLocalImage(images, path, alt);
    return '';
  });

  text = text.replace(/(^|[\s(])((\/[^\s)]+?\.(?:png|jpe?g|gif|webp)))(?=$|[\s),.;!?])/giu, (match, prefix, path) => {
    registerLocalImage(images, path);
    return prefix;
  });

  return {
    text: cleanupExtractedMessage(text),
    images: [...images.values()],
  };
}

function registerLocalImage(
  images: Map<string, { path: string; alt_text?: string }>,
  candidatePath: string,
  altText?: string,
): void {
  const normalizedPath = candidatePath.trim();
  const extension = extname(normalizedPath).toLowerCase();
  if (!LOCAL_IMAGE_EXTENSIONS.has(extension) || !existsSync(normalizedPath)) {
    return;
  }

  const existing = images.get(normalizedPath);
  if (existing) {
    if (!existing.alt_text && altText?.trim()) {
      existing.alt_text = altText.trim();
    }
    return;
  }

  images.set(normalizedPath, {
    path: normalizedPath,
    alt_text: altText?.trim() || undefined,
  });
}

function cleanupExtractedMessage(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function renderSlackText(text: string): string {
  const lines = text.split('\n');
  let inCodeBlock = false;

  return lines
    .map((line) => {
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        return line;
      }

      if (inCodeBlock) {
        return line;
      }

      if (!line.trim()) {
        return '';
      }

      const unorderedListMatch = line.match(/^(\s*)[-*+]\s+(.*)$/u);
      if (unorderedListMatch) {
        const indent = unorderedListMatch[1] ?? '';
        const content = unorderedListMatch[2] ?? '';
        return `${indent}* ${renderSlackInline(content)}`;
      }

      const orderedListMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/u);
      if (orderedListMatch) {
        const indent = orderedListMatch[1] ?? '';
        const number = orderedListMatch[2] ?? '';
        const content = orderedListMatch[3] ?? '';
        return `${indent}${number}. ${renderSlackInline(content)}`;
      }

      return renderSlackInline(line);
    })
    .join('\n');
}

function renderSlackInline(line: string): string {
  const segments = line.split(/(`[^`]*`)/u);

  return segments
    .map((segment) => {
      if (segment.startsWith('`') && segment.endsWith('`')) {
        return segment;
      }

      return segment
        .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gu, '$1 <$2>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gu, '<$2|$1>')
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, '_$1_')
        .replace(/\*\*([^*\n]+)\*\*/gu, '*$1*')
        .replace(/__([^_\n]+)__/gu, '*$1*')
        .replace(/~~([^~\n]+)~~/gu, '~$1~');
    })
    .join('');
}
