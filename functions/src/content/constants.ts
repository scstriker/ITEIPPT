

export const MAX_CONTENT_TEXT_LENGTH = 180_000;

export const CONTENT_PROMPT_MAX_DOC_CHARS = 36_000;

export const CONTENT_PROMPT_COMPACT_DOC_CHARS = 8_000;

export const CONTENT_BATCH_SIZE = 4;

export const CONTENT_SOFT_DEADLINE_MS = 500_000;

export const CONTENT_SOFT_DEADLINE_GUARD_MS = 20_000;

export const CONTENT_FALLBACK_BODY = '根据当前文档可提取信息不足，需补充原文依据后完善本页正文。';

export const CONTENT_FALLBACK_SOURCE_REF = '待补充原文依据';

export const CONCRETE_SIGNAL_PATTERN = /\d|%|万|亿|元|年|月|日|台|个|项|条|SQL|API|CPU|GPU|数据库|系统|平台/i;
