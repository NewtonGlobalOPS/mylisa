import "dotenv/config";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";

type TeachingChunk = {
  id: string;
  type: string;
  content: string;
  excerpt?: string[];
  matchReason?: string;
  objectiveCode?: string | null;
  objectiveTitle?: string | null;
  strand?: string | null;
  yearGroup?: number | null;
  tags?: string[];
};

type CanonicalQuestion = {
  id: string;
  sequence: number;
  promptText: string;
  answerText: string;
  difficulty: string;
  objectiveCode?: string;
  objectiveTitle?: string;
  strand?: string;
  yearGroup?: number | null;
  rationale?: string;
  contentJson?: unknown;
};

type VisualModel = {
  source: "oak" | "generated";
  kind: "image" | "svg";
  url?: string;
  svg?: string;
  alt: string;
  caption: string;
  prompt?: string;
};

type LearnerProfile = {
  child: {
    displayName: string;
    age: number;
    schoolYear: number | null;
    keyStage: string | null;
    interests?: string[];
  };
  presentation: {
    tutoringMode: string;
    verbosity: string;
    stepSize: string;
    lowStimulus: boolean;
    avoidMetaphors: boolean;
    useBullets: boolean;
    moreExamples: boolean;
    frequentCheckIns: boolean;
    readingLevel: number | null;
    attentionSpanMins: number | null;
    scaffolding: string;
    confidencePriority: string;
    rationale: string;
  };
  wrapperVectors: Array<{
    title: string;
    content: string;
    scope: string;
    strand: string | null;
  }>;
};

export type NeuroTeachingCard = {
  id: string;
  blockKey: string;
  audience: "TUTOR" | "STUDENT";
  title: string;
  source: "llm" | "fallback";
  fallbackReason?: string;
  chunkIds: string[];
  canonicalQuestionIds: string[];
  teachingScript: string[];
  studentFacingSummary: string;
  keyVocabulary: Array<{
    term: string;
    childDefinition: string;
  }>;
  workedExample: {
    title: string;
    steps: string[];
    answerCheck: string;
  };
  guidedPracticePrompts: string[];
  independentPrompt: string;
  microSteps: string[];
  visualModelSuggestion: string;
  visualModel?: VisualModel;
  checkForUnderstanding: string;
  likelyMisconception: string;
  repairPrompt: string;
  stretchPrompt: string;
  calmResetPrompt: string;
  tutorNotes: string[];
  sensoryLoad: "LOW" | "MEDIUM";
  neurodiverseSupports: string[];
};

type GenerateNeuroTeachingInput = {
  blockKey: string;
  organisationId?: string | null;
  studentId?: string | null;
  objectiveId?: string | null;
  objective: {
    code: string;
    title: string;
    strand: string;
    yearGroup: number | null;
    statement?: string;
  };
  chunks: TeachingChunk[];
  canonicalQuestions: CanonicalQuestion[];
  learnerProfile: LearnerProfile;
};

type GuardrailResult = {
  passed: boolean;
  reasons: string[];
};

function generatedLessonContentDelegate() {
  return (prisma as unknown as {
    generatedLessonContent?: {
      findUnique: (args: unknown) => Promise<{
        contentJson: unknown;
        status: string;
        source: string;
      } | null>;
      upsert: (args: unknown) => Promise<unknown>;
    };
  }).generatedLessonContent;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type OakImage = {
  url: string;
  alt: string;
};

function coerceOakImage(value: unknown, fallbackAlt: string): OakImage | null {
  if (typeof value === "string") {
    const url = clean(value);
    return url ? { url, alt: fallbackAlt } : null;
  }

  const record = asRecord(value);
  if (!record) return null;

  const url = clean(
    typeof record.url === "string"
      ? record.url
      : typeof record.src === "string"
        ? record.src
        : typeof record.path === "string"
          ? record.path
          : "",
  );
  if (!url) return null;

  const alt = clean(
    typeof record.alt === "string"
      ? record.alt
      : typeof record.altText === "string"
        ? record.altText
        : typeof record.description === "string"
          ? record.description
          : "",
  );

  return { url, alt: alt || fallbackAlt };
}

function collectOakImages(contentJson: unknown, fallbackAlt: string): OakImage[] {
  const root = asRecord(contentJson);
  if (!root) return [];

  const oak = asRecord(root.oak) ?? root;
  const candidates: unknown[] = [
    root.image,
    root.questionImage,
    root.stimulusImage,
    oak.image,
    oak.questionImage,
    oak.stimulusImage,
    ...asArray(root.stimulusImages),
    ...asArray(oak.stimulusImages),
  ];

  for (const choice of [...asArray(root.choices), ...asArray(oak.choices), ...asArray(oak.rawAnswers)]) {
    const record = asRecord(choice);
    if (record) candidates.push(record.image, record.questionImage);
  }

  const seen = new Set<string>();
  return candidates
    .map((candidate) => coerceOakImage(candidate, fallbackAlt))
    .filter((image): image is OakImage => Boolean(image))
    .filter((image) => {
      if (seen.has(image.url)) return false;
      seen.add(image.url);
      return true;
    });
}

function visualModelMatchesCard(visualModel: VisualModel, card: NeuroTeachingCard, input: GenerateNeuroTeachingInput): boolean {
  const objectiveOnlyText = objectiveText(input);
  const teachingText = [cardText(card), objectiveOnlyText].join("\n");
  const visualText = [visualModel.alt, visualModel.caption, visualModel.prompt, visualModel.svg]
    .join("\n")
    .toLowerCase();
  const visualIsGeneric =
    visualText.includes("simple visual model") ||
    (visualText.includes(">see<") && visualText.includes(">model<") && visualText.includes(">check<"));
  const wantsSequenceModel =
    hasAny(teachingText, ["sequence", "sequences", "nth term", "arithmetic sequence", "position-to-term", "position to term", "term-to-term", "term to term"]) &&
    hasAny(teachingText, ["common difference", "constant difference", "constant differences", "term number", "term value", "nth term", "rule"]);
  const visualIsSequenceModel =
    hasAny(visualText, ["arithmetic sequence", "common difference", "constant difference", "term number", "term value", "nth term", "4n"]);
  const wantsRightTriangle =
    hasAny(objectiveOnlyText, [
      "pythagoras",
      "trigonometry",
      "trigonometric",
      "right-angled",
      "right angled",
      "hypotenuse",
      "opposite",
      "adjacent",
      "sine",
      "cosine",
      "tangent",
      "soh",
      "cah",
      "toa",
    ]) && hasAny(objectiveOnlyText, ["triangle", "right-angled", "right angled", "side", "length", "angle"]);
  const visualIsRightTriangle = hasAny(visualText, [
    "hypotenuse",
    "opposite",
    "adjacent",
    "pythagoras",
    "trigonometry",
    "trigonometric",
    "sine",
    "cosine",
    "tangent",
    "soh",
    "cah",
    "toa",
    "right-angled triangle",
    "right angled triangle",
  ]);

  if (visualIsGeneric && wantsSequenceModel) return false;
  if (wantsSequenceModel && visualModel.source !== "oak") return visualIsSequenceModel;

  if (!wantsRightTriangle && visualIsRightTriangle) return false;

  if (wantsRightTriangle) {
    const hasOffTopicMeasurePrompt = hasAny(visualText, [
      "perimeter",
      "trapezium",
      "rectangle",
      "rectangular",
      "circle",
      "circumference",
      "sector",
      "area",
    ]);
    const hasTrigSpecificLanguage = hasAny(visualText, [
      "hypotenuse",
      "opposite",
      "adjacent",
      "pythagoras",
      "trigonometry",
      "sine",
      "cosine",
      "tangent",
      "soh",
      "cah",
      "toa",
    ]);
    if (hasOffTopicMeasurePrompt && !hasTrigSpecificLanguage) return false;

    if (visualModel.source !== "oak") {
      return hasTrigSpecificLanguage;
    }

    return hasAny(visualText, [
      "triangle",
      "right-angled",
      "right angled",
      "hypotenuse",
      "opposite",
      "adjacent",
      "pythagoras",
      "trigonometry",
      "sine",
      "cosine",
      "tangent",
    ]);
  }

  if (visualModel.source !== "oak") return true;

  const teachingTokens = new Set(
    teachingText
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 4 && !["with", "this", "that", "from", "will", "step", "answer"].includes(token)),
  );
  const visualTokens = visualText
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 4);
  const overlap = visualTokens.filter((token) => teachingTokens.has(token)).length;
  return overlap >= 2;
}

function oakVisualModel(card: NeuroTeachingCard, input: GenerateNeuroTeachingInput): VisualModel | null {
  for (const question of input.canonicalQuestions) {
    const fallbackAlt = `Visual for ${question.promptText || input.objective.title}`;
    const image = collectOakImages(question.contentJson, fallbackAlt)[0];
    if (!image) continue;
    const visualModel = {
      source: "oak",
      kind: "image",
      url: image.url,
      alt: image.alt,
      caption: `Oak visual for: ${question.promptText || input.objective.title}`.slice(0, 180),
    } satisfies VisualModel;
    if (visualModelMatchesCard(visualModel, card, input)) return visualModel;
  }
  return null;
}

function pointToPixel(x: number, y: number) {
  const left = 72;
  const top = 32;
  const width = 600;
  const height = 320;
  const xmin = -4;
  const xmax = 4;
  const ymin = -5;
  const ymax = 5;
  return {
    x: left + ((x - xmin) / (xmax - xmin)) * width,
    y: top + ((ymax - y) / (ymax - ymin)) * height,
  };
}

function quadraticGraphSvg(): string {
  const path = Array.from({ length: 121 }, (_, index) => {
    const x = -3 + index * 0.05;
    const y = x * x - 4;
    const point = pointToPixel(x, y);
    return `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }).join(" ");
  const xAxis = pointToPixel(0, 0).y;
  const yAxis = pointToPixel(0, 0).x;
  const points = [
    { label: "(-2, 0)", x: -2, y: 0, dx: -70, dy: -14 },
    { label: "(2, 0)", x: 2, y: 0, dx: 14, dy: -14 },
    { label: "(0, -4)", x: 0, y: -4, dx: 14, dy: 18 },
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-label="Graph of y equals x squared minus 4 with labelled roots and turning point">
  <rect width="720" height="420" fill="#ffffff"/>
  <text x="72" y="28" fill="#142336" font-family="Arial, sans-serif" font-size="20" font-weight="700">y = x^2 - 4</text>
  <g stroke="#d7e3ee" stroke-width="1">
    ${[-4, -3, -2, -1, 1, 2, 3, 4]
      .map((x) => {
        const p = pointToPixel(x, 0);
        return `<line x1="${p.x.toFixed(1)}" y1="32" x2="${p.x.toFixed(1)}" y2="352"/>`;
      })
      .join("")}
    ${[-4, -3, -2, -1, 1, 2, 3, 4]
      .map((y) => {
        const p = pointToPixel(0, y);
        return `<line x1="72" y1="${p.y.toFixed(1)}" x2="672" y2="${p.y.toFixed(1)}"/>`;
      })
      .join("")}
  </g>
  <line x1="72" y1="${xAxis.toFixed(1)}" x2="672" y2="${xAxis.toFixed(1)}" stroke="#142336" stroke-width="2"/>
  <line x1="${yAxis.toFixed(1)}" y1="32" x2="${yAxis.toFixed(1)}" y2="352" stroke="#142336" stroke-width="2"/>
  <text x="678" y="${(xAxis + 6).toFixed(1)}" fill="#142336" font-family="Arial, sans-serif" font-size="16">x</text>
  <text x="${(yAxis - 5).toFixed(1)}" y="22" fill="#142336" font-family="Arial, sans-serif" font-size="16">y</text>
  <path d="${path}" fill="none" stroke="#2f6ca4" stroke-width="4" stroke-linecap="round"/>
  ${points
    .map((item) => {
      const point = pointToPixel(item.x, item.y);
      return `<g>
        <circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="7" fill="#1f7e60" stroke="#ffffff" stroke-width="3"/>
        <text x="${(point.x + item.dx).toFixed(1)}" y="${(point.y + item.dy).toFixed(1)}" fill="#142336" font-family="Arial, sans-serif" font-size="17" font-weight="700">${item.label}</text>
      </g>`;
    })
    .join("")}
  <text x="72" y="390" fill="#5c6f8c" font-family="Arial, sans-serif" font-size="16">Roots: (-2, 0) and (2, 0). Turning point: (0, -4).</text>
</svg>`;
}

function genericModelSvg(input: GenerateNeuroTeachingInput, suggestion: string): string {
  const title = escapeXml(input.objective.title || "Visual model");
  const label = escapeXml(clean(suggestion).slice(0, 120) || "Use one clear diagram and label the key parts.");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 320" role="img" aria-label="Simple visual model">
  <rect width="720" height="320" fill="#ffffff"/>
  <text x="48" y="48" fill="#142336" font-family="Arial, sans-serif" font-size="22" font-weight="700">${title}</text>
  <g fill="#f4f8fb" stroke="#d7e3ee" stroke-width="2">
    <rect x="56" y="92" width="172" height="116" rx="12"/>
    <rect x="274" y="92" width="172" height="116" rx="12"/>
    <rect x="492" y="92" width="172" height="116" rx="12"/>
  </g>
  <g fill="#142336" font-family="Arial, sans-serif" font-weight="700" font-size="20" text-anchor="middle">
    <text x="142" y="154">See</text>
    <text x="360" y="154">Model</text>
    <text x="578" y="154">Check</text>
  </g>
  <path d="M228 150 H274 M446 150 H492" stroke="#2f6ca4" stroke-width="4" stroke-linecap="round"/>
  <text x="48" y="264" fill="#5c6f8c" font-family="Arial, sans-serif" font-size="17">${label}</text>
</svg>`;
}

function shapeVocabularyBoardSvg(input: GenerateNeuroTeachingInput, suggestion: string): string {
  const titleLines = wrapSvgText(input.objective.title || "Shape teaching board", 64, 2);
  const promptLines = wrapSvgText(suggestion || "Use the labelled board to teach the vocabulary before practice.", 92, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1040 700" role="img" aria-label="Teaching board for nets polygons faces edges vertices and angle facts">
  <rect width="1040" height="700" fill="#ffffff"/>
  ${titleLines.map((line, index) => `<text x="54" y="${52 + index * 30}" fill="#142336" font-family="Arial, sans-serif" font-size="26" font-weight="700">${escapeXml(line)}</text>`).join("")}
  <text x="54" y="116" fill="#5c6f8c" font-family="Arial, sans-serif" font-size="18">Teach these labels before the question round.</text>

  <g font-family="Arial, sans-serif">
    <rect x="54" y="144" width="446" height="270" rx="10" fill="#f8fbfd" stroke="#d7e3ee" stroke-width="2"/>
    <text x="82" y="180" fill="#142336" font-size="23" font-weight="700">3D shape language</text>
    <polygon points="142,252 232,206 322,252 232,300" fill="#d8ecff" stroke="#142336" stroke-width="3"/>
    <polygon points="142,252 232,300 232,378 142,330" fill="#f7fbff" stroke="#142336" stroke-width="3"/>
    <polygon points="322,252 232,300 232,378 322,330" fill="#edf7ed" stroke="#142336" stroke-width="3"/>
    <line x1="232" y1="206" x2="232" y2="300" stroke="#142336" stroke-width="3"/>
    <circle cx="322" cy="252" r="7" fill="#805ad5"/>
    <path d="M282 278 L356 318" stroke="#d97706" stroke-width="7" stroke-linecap="round"/>
    <path d="M260 326 L308 352 L308 314 Z" fill="#1f7e60" opacity="0.24"/>
    <g font-size="17" font-weight="700">
      <text x="344" y="248" fill="#805ad5">vertex</text>
      <text x="374" y="323" fill="#d97706">edge</text>
      <text x="316" y="374" fill="#1f7e60">face</text>
      <text x="82" y="396" fill="#5c6f8c">corner, line, flat surface</text>
    </g>

    <rect x="540" y="144" width="446" height="270" rx="10" fill="#f8fbfd" stroke="#d7e3ee" stroke-width="2"/>
    <text x="568" y="180" fill="#142336" font-size="23" font-weight="700">Net of a cube</text>
    ${[
      [660, 252], [718, 252], [776, 252],
      [718, 194], [718, 310], [718, 368],
    ].map(([x, y], index) => `<g><rect x="${x}" y="${y}" width="56" height="56" fill="${index === 1 ? "#d8ecff" : "#ffffff"}" stroke="#142336" stroke-width="3"/><text x="${x + 28}" y="${y + 35}" fill="#5c6f8c" font-size="13" font-weight="700" text-anchor="middle">face</text></g>`).join("")}
    <path d="M842 242 C890 228 916 260 884 292" fill="none" stroke="#2f6ca4" stroke-width="4" stroke-linecap="round"/>
    <path d="M884 292 L878 270 L902 278" fill="#2f6ca4"/>
    <text x="568" y="394" fill="#142336" font-size="17" font-weight="700">net = flat pattern that folds into a 3D shape</text>

    <rect x="54" y="448" width="446" height="178" rx="10" fill="#ffffff" stroke="#d7e3ee" stroke-width="2"/>
    <text x="82" y="484" fill="#142336" font-size="23" font-weight="700">Polygon check</text>
    <polygon points="126,566 164,516 236,528 264,582 194,600" fill="#e8f4ff" stroke="#2f6ca4" stroke-width="4"/>
    <g fill="#142336" font-size="20" font-weight="700">
      <text x="314" y="528">flat</text>
      <text x="314" y="562">closed</text>
      <text x="314" y="596">straight sides</text>
    </g>

    <rect x="540" y="448" width="446" height="178" rx="10" fill="#ffffff" stroke="#d7e3ee" stroke-width="2"/>
    <text x="568" y="484" fill="#142336" font-size="23" font-weight="700">Angle facts</text>
    <polygon points="604,574 680,506 756,574" fill="#fff7ed" stroke="#d97706" stroke-width="4"/>
    <rect x="824" y="506" width="96" height="68" fill="#edf7ed" stroke="#1f7e60" stroke-width="4"/>
    <g font-size="17" font-weight="700" text-anchor="middle">
      <text x="680" y="604" fill="#d97706">triangle = 180 degrees</text>
      <text x="872" y="604" fill="#1f7e60">quadrilateral = 360 degrees</text>
    </g>
  </g>
  ${promptLines.map((line, index) => `<text x="54" y="${662 + index * 20}" fill="#5c6f8c" font-family="Arial, sans-serif" font-size="16">${escapeXml(line)}</text>`).join("")}
</svg>`;
}

function sequenceNthTermSvg(input: GenerateNeuroTeachingInput): string {
  const title = escapeXml(input.objective.title || "Arithmetic sequence nth-term model");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 920 520" role="img" aria-label="Arithmetic sequence shown as term number, term value, common difference and nth term rule">
  <rect width="920" height="520" fill="#ffffff"/>
  <text x="52" y="52" fill="#142336" font-family="Arial, sans-serif" font-size="26" font-weight="700">${title}</text>
  <text x="52" y="84" fill="#5c6f8c" font-family="Arial, sans-serif" font-size="18">Example sequence: 3, 7, 11, 15, ...</text>

  <g font-family="Arial, sans-serif">
    <rect x="70" y="120" width="520" height="190" rx="8" fill="#f8fbfd" stroke="#d7e3ee" stroke-width="2"/>
    <g fill="#142336" font-size="20" font-weight="700" text-anchor="middle">
      <text x="178" y="160">Term number n</text>
      <text x="430" y="160">Term value</text>
    </g>
    <line x1="70" y1="176" x2="590" y2="176" stroke="#d7e3ee" stroke-width="2"/>
    <line x1="286" y1="120" x2="286" y2="310" stroke="#d7e3ee" stroke-width="2"/>
    ${[1, 2, 3, 4].map((n, index) => {
      const y = 208 + index * 36;
      const value = 4 * n - 1;
      return `<g>
        <text x="178" y="${y}" fill="#142336" font-size="22" text-anchor="middle">${n}</text>
        <text x="430" y="${y}" fill="#142336" font-size="22" text-anchor="middle">${value}</text>
      </g>`;
    }).join("")}

    <g fill="#1f7e60" font-size="19" font-weight="700" text-anchor="middle">
      <path d="M640 226 H838" stroke="#1f7e60" stroke-width="4" stroke-linecap="round"/>
      <path d="M820 210 L840 226 L820 242" fill="none" stroke="#1f7e60" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="740" y="204">common difference = +4</text>
    </g>

    <rect x="112" y="348" width="696" height="98" rx="10" fill="#ffffff" stroke="#2f6ca4" stroke-width="3"/>
    <text x="146" y="386" fill="#142336" font-size="23" font-weight="700">nth term rule</text>
    <text x="146" y="422" fill="#5c6f8c" font-size="21">multiply n by the common difference, then adjust to match term 1</text>
    <text x="652" y="407" fill="#2f6ca4" font-size="34" font-weight="700" text-anchor="middle">4n - 1</text>

    <g fill="#805ad5" font-size="18" font-weight="700">
      <text x="70" y="486">Check: n = 1 gives 4 x 1 - 1 = 3, so the rule matches the first term.</text>
    </g>
  </g>
</svg>`;
}

function wrapSvgText(value: string, maxChars = 58, maxLines = 3): string[] {
  const words = clean(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
      if (lines.length >= maxLines) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : ["Visual model"];
}

function atmosphereCompositionSvg(): string {
  const gases = [
    { label: "Nitrogen", value: 78, colour: "#2f6ca4" },
    { label: "Oxygen", value: 21, colour: "#1f7e60" },
    { label: "Argon", value: 0.9, colour: "#805ad5" },
    { label: "Carbon dioxide", value: 0.04, colour: "#d97706" },
    { label: "Other gases", value: 0.06, colour: "#5c6f8c" },
  ];
  const max = 80;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 500" role="img" aria-label="Bar chart showing composition of the atmosphere by percentage">
  <rect width="900" height="500" fill="#ffffff"/>
  <text x="60" y="54" fill="#142336" font-family="Arial, sans-serif" font-size="30" font-weight="700">Composition of the atmosphere</text>
  <text x="60" y="86" fill="#5c6f8c" font-family="Arial, sans-serif" font-size="18">Approximate percentage of gases in dry air</text>
  <line x1="170" y1="390" x2="820" y2="390" stroke="#142336" stroke-width="2"/>
  <line x1="170" y1="120" x2="170" y2="390" stroke="#142336" stroke-width="2"/>
  <g font-family="Arial, sans-serif" fill="#5c6f8c" font-size="14" text-anchor="end">
    ${[0, 20, 40, 60, 80].map((tick) => {
      const y = 390 - (tick / max) * 260;
      return `<g><line x1="164" y1="${y.toFixed(1)}" x2="820" y2="${y.toFixed(1)}" stroke="#d7e3ee"/><text x="154" y="${(y + 5).toFixed(1)}">${tick}%</text></g>`;
    }).join("")}
  </g>
  <g font-family="Arial, sans-serif">
    ${gases.map((gas, index) => {
      const barWidth = 86;
      const gap = 38;
      const x = 205 + index * (barWidth + gap);
      const height = Math.max(4, (gas.value / max) * 260);
      const y = 390 - height;
      return `<g>
        <rect x="${x}" y="${y.toFixed(1)}" width="${barWidth}" height="${height.toFixed(1)}" rx="4" fill="${gas.colour}"/>
        <text x="${x + barWidth / 2}" y="${(y - 10).toFixed(1)}" fill="#142336" font-size="18" font-weight="700" text-anchor="middle">${gas.value}%</text>
        <text x="${x + barWidth / 2}" y="426" fill="#142336" font-size="16" font-weight="700" text-anchor="middle">${escapeXml(gas.label)}</text>
      </g>`;
    }).join("")}
  </g>
  <text x="60" y="470" fill="#5c6f8c" font-family="Arial, sans-serif" font-size="17">Teaching check: nitrogen is the largest part, oxygen is second, and the remaining gases together are less than 1%.</text>
</svg>`;
}

function dataChartSvg(input: GenerateNeuroTeachingInput, suggestion: string): string {
  const titleLines = wrapSvgText(input.objective.title || "Chart model", 54, 2);
  const labelLines = wrapSvgText(suggestion || "Use a labelled chart with percentages and a short comparison sentence.", 74, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 500" role="img" aria-label="Labelled chart model with percentages">
  <rect width="900" height="500" fill="#ffffff"/>
  ${titleLines.map((line, index) => `<text x="60" y="${54 + index * 30}" fill="#142336" font-family="Arial, sans-serif" font-size="28" font-weight="700">${escapeXml(line)}</text>`).join("")}
  <g font-family="Arial, sans-serif">
    <line x1="150" y1="390" x2="800" y2="390" stroke="#142336" stroke-width="2"/>
    <line x1="150" y1="130" x2="150" y2="390" stroke="#142336" stroke-width="2"/>
    <g fill="#5c6f8c" font-size="14" text-anchor="end">
      ${[0, 25, 50, 75, 100].map((tick) => {
        const y = 390 - (tick / 100) * 250;
        return `<g><line x1="144" y1="${y}" x2="800" y2="${y}" stroke="#d7e3ee"/><text x="134" y="${y + 5}">${tick}%</text></g>`;
      }).join("")}
    </g>
    <rect x="210" y="160" width="110" height="230" rx="4" fill="#2f6ca4"/>
    <rect x="395" y="260" width="110" height="130" rx="4" fill="#1f7e60"/>
    <rect x="580" y="348" width="110" height="42" rx="4" fill="#805ad5"/>
    <g fill="#142336" font-size="18" font-weight="700" text-anchor="middle">
      <text x="265" y="148">largest %</text>
      <text x="450" y="248">second %</text>
      <text x="635" y="336">small %</text>
      <text x="265" y="424">Category A</text>
      <text x="450" y="424">Category B</text>
      <text x="635" y="424">Other</text>
    </g>
  </g>
  ${labelLines.map((line, index) => `<text x="60" y="${462 + index * 22}" fill="#5c6f8c" font-family="Arial, sans-serif" font-size="17">${escapeXml(line)}</text>`).join("")}
</svg>`;
}

function conciseVisualCaption(suggestion: string) {
  const firstLine = clean(suggestion).split(/\n+/).find((line) => line.trim());
  return firstLine
    ? firstLine.slice(0, 180)
    : "Generated visual model: clear representation with labelled steps.";
}

function substitutionFormulaSvg(input: GenerateNeuroTeachingInput): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 420" role="img" aria-label="Substitution into a formula shown as identify values substitute calculate check">
  <rect width="900" height="420" fill="#ffffff"/>
  <text x="450" y="46" fill="#142336" font-family="Arial, sans-serif" font-size="26" font-weight="700" text-anchor="middle">Substitute Into a Formula</text>
  <g font-family="Arial, sans-serif">
    <rect x="170" y="78" width="560" height="62" rx="10" fill="#f4f8fb" stroke="#d7e3ee" stroke-width="2"/>
    <text x="212" y="117" fill="#142336" font-size="30" font-weight="700">d = s x t</text>
    <text x="410" y="116" fill="#5c6f8c" font-size="20">keep the formula order</text>

    <rect x="90" y="174" width="210" height="86" rx="10" fill="#ffffff" stroke="#2f6ca4" stroke-width="3"/>
    <text x="120" y="208" fill="#142336" font-size="22" font-weight="700">1. Identify</text>
    <text x="120" y="238" fill="#5c6f8c" font-size="20">s = 12, t = 4</text>

    <rect x="345" y="174" width="210" height="86" rx="10" fill="#ffffff" stroke="#2f6ca4" stroke-width="3"/>
    <text x="375" y="208" fill="#142336" font-size="22" font-weight="700">2. Substitute</text>
    <text x="375" y="238" fill="#5c6f8c" font-size="20">d = 12 x 4</text>

    <rect x="600" y="174" width="210" height="86" rx="10" fill="#ffffff" stroke="#2f6ca4" stroke-width="3"/>
    <text x="630" y="208" fill="#142336" font-size="22" font-weight="700">3. Calculate</text>
    <text x="630" y="238" fill="#5c6f8c" font-size="20">d = 48</text>

    <path d="M300 217 H345 M555 217 H600" stroke="#805ad5" stroke-width="6" stroke-linecap="round"/>
    <rect x="170" y="302" width="560" height="76" rx="10" fill="#f8fbfd" stroke="#d7e3ee" stroke-width="2"/>
    <text x="204" y="332" fill="#142336" font-size="21" font-weight="700">Check</text>
    <text x="286" y="332" fill="#5c6f8c" font-size="19">Each letter is replaced once.</text>
    <text x="204" y="360" fill="#5c6f8c" font-size="19">Tutor prompt: Which number replaces s? Which replaces t?</text>
  </g>
</svg>`;
}

function rightTriangleSvg(input: GenerateNeuroTeachingInput): string {
  const title = escapeXml(input.objective.title || "Right-angled triangle model");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 420" role="img" aria-label="Right-angled triangle labelled opposite adjacent and hypotenuse">
  <rect width="720" height="420" fill="#ffffff"/>
  <text x="48" y="44" fill="#142336" font-family="Arial, sans-serif" font-size="21" font-weight="700">${title}</text>
  <g stroke="#142336" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none">
    <path d="M160 320 H545 L160 92 Z"/>
  </g>
  <path d="M160 284 H196 V320" fill="none" stroke="#805ad5" stroke-width="5"/>
  <path d="M196 320 A170 170 0 0 1 247 198" fill="none" stroke="#2f6ca4" stroke-width="4"/>
  <text x="238" y="285" fill="#2f6ca4" font-family="Arial, sans-serif" font-size="22" font-weight="700">35°</text>
  <text x="342" y="354" fill="#142336" font-family="Arial, sans-serif" font-size="24" font-weight="700" text-anchor="middle">adjacent = 8 cm</text>
  <text x="118" y="212" fill="#142336" font-family="Arial, sans-serif" font-size="24" font-weight="700" text-anchor="middle" transform="rotate(-90 118 212)">opposite = x</text>
  <text x="374" y="180" fill="#142336" font-family="Arial, sans-serif" font-size="24" font-weight="700" text-anchor="middle" transform="rotate(-31 374 180)">hypotenuse</text>
  <g fill="#5c6f8c" font-family="Arial, sans-serif" font-size="18">
    <text x="48" y="384">Use tangent when the known side is adjacent and the unknown side is opposite: tan(35°) = x / 8.</text>
  </g>
</svg>`;
}

function generatedVisualModel(input: GenerateNeuroTeachingInput, suggestion: string): VisualModel {
  const objectiveOnly = objectiveText(input);
  const supportingText = [
    input.objective.title,
    input.objective.statement,
    input.canonicalQuestions.map((question) => question.promptText).join("\n"),
    input.chunks.map(chunkText).join("\n"),
    suggestion,
  ]
    .join("\n")
    .toLowerCase();
  const isQuadraticGraph =
    (supportingText.includes("x^2") || supportingText.includes("x squared") || supportingText.includes("quadratic")) &&
    (supportingText.includes("graph") || supportingText.includes("parabola") || supportingText.includes("roots"));
  const isSubstitutionFormula =
    hasAny(objectiveOnly, ["substitute", "substitution", "numerical values"]) &&
    hasAny(objectiveOnly, ["formula", "formulae", "expression", "expressions"]);
  const isRightTriangle =
    hasAny(objectiveOnly, ["pythagoras", "trigonometry", "trigonometric", "hypotenuse", "opposite", "adjacent", "tangent", "sine", "cosine"]) &&
    hasAny(objectiveOnly, ["triangle", "right-angled", "right angled", "angle", "length"]);
  const isSequenceModel =
    hasAny(supportingText, ["sequence", "sequences", "nth term", "arithmetic sequence", "position-to-term", "position to term", "term-to-term", "term to term"]) &&
    hasAny(supportingText, ["common difference", "constant difference", "constant differences", "term number", "term value", "rule", "nth term"]);
  const isAtmosphereComposition =
    hasAny(supportingText, ["composition of the atmosphere", "atmosphere", "gases"]) &&
    hasAny(supportingText, ["percentage", "percent", "%", "nitrogen", "oxygen", "carbon dioxide"]);
  const isShapeVocabularyBoard =
    hasAny(supportingText, ["net", "nets", "polygon", "polygons", "2d", "3d", "face", "faces", "edge", "edges", "vertex", "vertices", "solid", "cube", "cuboid"]) ||
    (hasAny(supportingText, ["triangle", "quadrilateral", "angle"]) &&
      hasAny(supportingText, ["180", "360", "missing angle", "angle fact", "unknown angle"]));
  const needsChart =
    hasAny(supportingText, ["chart", "bar chart", "pie chart", "percentage", "percent", "%", "data", "frequency"]) &&
    !isQuadraticGraph &&
    !isSubstitutionFormula &&
    !isRightTriangle &&
    !isShapeVocabularyBoard;

  return {
    source: "generated",
    kind: "svg",
    svg: isQuadraticGraph
      ? quadraticGraphSvg()
      : isSubstitutionFormula
        ? substitutionFormulaSvg(input)
      : isRightTriangle
        ? rightTriangleSvg(input)
      : isSequenceModel
        ? sequenceNthTermSvg(input)
      : isAtmosphereComposition
        ? atmosphereCompositionSvg()
      : isShapeVocabularyBoard
        ? shapeVocabularyBoardSvg(input, suggestion)
      : needsChart
        ? dataChartSvg(input, suggestion)
        : genericModelSvg(input, suggestion),
    alt: isQuadraticGraph
      ? "Graph of y equals x squared minus 4 with labelled roots and turning point"
      : isSubstitutionFormula
        ? "Substitution into a formula shown as name values substitute calculate check"
      : isRightTriangle
        ? "Right-angled triangle labelled opposite adjacent and hypotenuse"
      : isSequenceModel
        ? "Arithmetic sequence table with common difference and nth term rule"
      : isAtmosphereComposition
        ? "Bar chart showing the percentage composition of the atmosphere"
      : isShapeVocabularyBoard
        ? "Teaching board with a labelled solid, cube net, polygon checklist and angle facts"
      : needsChart
        ? "Labelled chart model showing percentages"
      : `Visual model for ${input.objective.title}`,
    caption: isSubstitutionFormula
      ? "Generated visual model: substitute values into a formula using name, substitute, calculate, check."
      : isRightTriangle
      ? "Generated visual model: right-angled triangle labelled with opposite, adjacent, hypotenuse, and a tangent equation."
      : isSequenceModel
      ? "Generated visual model: arithmetic sequence table linked to common difference and nth-term rule."
      : isAtmosphereComposition
      ? "Generated visual model: bar chart of atmosphere gases by percentage."
      : isShapeVocabularyBoard
      ? "Generated teaching board: labelled solid, cube net, polygon checklist, and angle facts for the upcoming questions."
      : needsChart
      ? "Generated visual model: labelled chart with percentage scale."
      : conciseVisualCaption(suggestion),
    prompt: clean(suggestion),
  };
}

function addVisualModel(card: NeuroTeachingCard, input: GenerateNeuroTeachingInput): NeuroTeachingCard {
  const existing =
    card.visualModel && visualModelMatchesCard(card.visualModel, card, input)
      ? card.visualModel
      : null;

  return {
    ...card,
    visualModel:
      existing ??
      oakVisualModel(card, input) ??
      generatedVisualModel(input, [card.visualModelSuggestion, cardText(card)].join("\n")),
  };
}

function azureEndpointBase(): string {
  return clean(process.env.AZURE_OPENAI_ENDPOINT)
    .replace(/\/+$/, "")
    .replace(/\/openai$/i, "");
}

function hasLlmConfig(): boolean {
  return Boolean(
    process.env.AZURE_OPENAI_ENDPOINT &&
      process.env.AZURE_OPENAI_DEPLOYMENT &&
      process.env.AZURE_OPENAI_API_KEY,
  );
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function chunkText(chunk: TeachingChunk): string {
  const excerpt = chunk.excerpt?.join("\n");
  return clean(chunk.content || excerpt);
}

function isProbablyNoise(chunk: TeachingChunk): boolean {
  const text = chunkText(chunk).toLowerCase();
  if (text.length < 80) return true;
  const farewellSignals = [
    "bye everybody",
    "see you again soon",
    "enjoy the rest of your day",
    "well done for all",
  ];
  if (farewellSignals.some((signal) => text.includes(signal)) && text.length < 500) {
    return true;
  }
  return false;
}

function relevantChunks(chunks: TeachingChunk[]): TeachingChunk[] {
  return chunks
    .filter((chunk) => !isProbablyNoise(chunk))
    .slice(0, 5);
}

function compactChunk(chunk: TeachingChunk) {
  return {
    id: chunk.id,
    type: chunk.type,
    objectiveCode: chunk.objectiveCode ?? null,
    strand: chunk.strand ?? null,
    yearGroup: chunk.yearGroup ?? null,
    matchReason: chunk.matchReason ?? null,
    content: chunkText(chunk).slice(0, 520),
    tags: chunk.tags?.slice(0, 5) ?? [],
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const TEACHING_CARD_CACHE_VERSION = "neuro-teaching-card-v16-retry-no-fallback";

type ObjectiveFamily =
  | "NUMBER"
  | "ALGEBRA"
  | "GEOMETRY"
  | "DATA"
  | "RATIO"
  | "PROBABILITY"
  | "MEASURE"
  | "UNKNOWN";

function cacheKeyFor(input: GenerateNeuroTeachingInput): string {
  return sha256(
    stableJson({
      version: TEACHING_CARD_CACHE_VERSION,
      blockKey: input.blockKey,
      organisationId: input.organisationId ?? null,
      studentId: input.studentId ?? input.learnerProfile.child.displayName,
      objectiveId: input.objectiveId ?? input.objective.code,
      objective: input.objective,
      chunkIds: relevantChunks(input.chunks).map((chunk) => chunk.id).sort(),
      canonicalQuestionIds: input.canonicalQuestions.map((question) => question.id).sort(),
      presentation: input.learnerProfile.presentation,
      wrapperVectors: input.learnerProfile.wrapperVectors.map((vector) => ({
        title: vector.title,
        content: vector.content,
        scope: vector.scope,
        strand: vector.strand,
      })),
    }),
  );
}

function cardText(card: NeuroTeachingCard): string {
  return [
    card.title,
    card.studentFacingSummary,
    ...card.teachingScript,
    ...card.workedExample.steps,
    card.workedExample.answerCheck,
    ...card.guidedPracticePrompts,
    card.independentPrompt,
    ...card.microSteps,
    card.visualModelSuggestion,
    card.checkForUnderstanding,
    card.likelyMisconception,
    card.repairPrompt,
    card.stretchPrompt,
  ]
    .join("\n")
    .toLowerCase();
}

function objectiveText(input: GenerateNeuroTeachingInput): string {
  return [input.objective.title, input.objective.statement, input.objective.strand]
    .join("\n")
    .toLowerCase();
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function classifyObjectiveFamily(input: GenerateNeuroTeachingInput): ObjectiveFamily {
  const text = objectiveText(input);
  if (hasAny(text, ["probability", "outcome", "event", "sample space"])) return "PROBABILITY";
  if (hasAny(text, ["data", "statistic", "mean", "median", "range", "frequency", "sampling", "summary"])) {
    return "DATA";
  }
  if (hasAny(text, ["algebra", "expression", "equation", "formula", "sequence", "linear", "graph", "function", "inequal", "iteration", "simultaneous"])) {
    return "ALGEBRA";
  }
  if (hasAny(text, ["geometry", "geometrical", "shape", "angle", "triangle", "quadrilateral", "circle", "polygon", "perimeter", "area", "volume", "construction", "trigonometry", "pythagoras", "bearing", "loci", "coordinate", "symmetry", "transformation"])) {
    return "GEOMETRY";
  }
  if (hasAny(text, ["ratio", "proportion", "scale factor", "compound measure", "multiplicative relationship"])) {
    return "RATIO";
  }
  if (hasAny(text, ["measure", "length", "mass", "capacity", "time", "money", "unit"])) return "MEASURE";
  if (hasAny(text, ["number", "fraction", "decimal", "integer", "percentage", "place value", "rounding", "surd", "standard form", "addition", "subtraction", "multiplication", "division", "arithmetic"])) {
    return "NUMBER";
  }
  return "UNKNOWN";
}

function familyMarkers(family: ObjectiveFamily): string[] {
  switch (family) {
    case "ALGEBRA":
      return ["algebra", "expression", "equation", "formula", "term", "coefficient", "variable", "index", "power", "sequence", "graph", "linear", "function"];
    case "GEOMETRY":
      return [
        "angle",
        "shape",
        "triangle",
        "right-angled",
        "right angled",
        "hypotenuse",
        "opposite",
        "adjacent",
        "pythagoras",
        "pythagorean",
        "sine",
        "cosine",
        "tangent",
        "soh",
        "cah",
        "toa",
        "quadrilateral",
        "circle",
        "polygon",
        "perimeter",
        "area",
        "volume",
        "construction",
        "coordinate",
        "symmetry",
        "transformation",
        "bearing",
        "trigonometry",
      ];
    case "DATA":
      return ["data", "table", "chart", "graph", "mean", "median", "mode", "range", "frequency", "sample", "statistic", "summary"];
    case "RATIO":
      return ["ratio", "proportion", "scale", "multiplier", "unit rate", "compound measure"];
    case "PROBABILITY":
      return ["probability", "outcome", "event", "sample space", "chance", "likely", "unlikely", "tree diagram"];
    case "MEASURE":
      return ["measure", "unit", "length", "mass", "capacity", "time", "money", "convert", "metric"];
    case "NUMBER":
      return ["number", "fraction", "decimal", "integer", "percentage", "place value", "rounding", "arithmetic", "multiple", "factor"];
    default:
      return [];
  }
}

function targetTokens(input: GenerateNeuroTeachingInput): string[] {
  const stopwords = new Set([
    "and",
    "the",
    "with",
    "using",
    "including",
    "place",
    "from",
    "into",
    "solve",
    "problems",
    "interpret",
    "derive",
    "illustrate",
    "calculate",
    "read",
    "write",
    "use",
    "understand",
    "appropriate",
    "language",
  ]);
  return Array.from(
    new Set(
      objectiveText(input)
        .split(/[^a-z0-9²³]+/g)
        .filter((token) => token.length >= 3 && !stopwords.has(token)),
    ),
  ).slice(0, 16);
}

function hasSymbolicObjectiveEvidence(text: string, input: GenerateNeuroTeachingInput): boolean {
  const objective = objectiveText(input);
  const wantsAlgebraNotation = hasAny(objective, ["algebraic notation", "coefficient", "index", "power", "a²", "a³", "ab in place"]);
  const wantsEquation = hasAny(objective, ["equation", "formula", "rearrange", "linear"]);
  const wantsGraph = hasAny(objective, ["graph", "coordinate", "linear"]);

  if (wantsAlgebraNotation) {
    return /\b\d+[a-z]\b|\b[a-z]{2}\b|[a-z]\^?[23]\b|[a-z][²³]/i.test(text);
  }
  if (wantsEquation) {
    return /[a-z]\s*[+\-*/=]|\=\s*[a-z0-9]|[a-z]\^?\d/i.test(text);
  }
  if (wantsGraph) {
    return hasAny(text, ["axis", "axes", "coordinate", "gradient", "intercept", "plot", "graph"]);
  }
  return true;
}

function validateObjectiveAlignment(card: NeuroTeachingCard, input: GenerateNeuroTeachingInput): string[] {
  if (input.blockKey.includes("student")) return [];

  const reasons: string[] = [];
  const family = classifyObjectiveFamily(input);
  const text = cardText(card);
  const markers = familyMarkers(family);
  const tokens = targetTokens(input);
  const matchedTargetTokens = tokens.filter((token) => text.includes(token));
  const year = input.objective.yearGroup ?? input.learnerProfile.child.schoolYear ?? null;
  const isSecondary = (year ?? 0) >= 7 || input.learnerProfile.child.keyStage === "KS3" || input.learnerProfile.child.keyStage === "KS4";

  if (markers.length && !hasAny(text, markers)) {
    reasons.push(`Worked example does not use ${family.toLowerCase()} domain vocabulary.`);
  }

  if (tokens.length >= 3 && matchedTargetTokens.length < Math.min(2, tokens.length)) {
    reasons.push("Worked example does not echo enough of the active objective vocabulary.");
  }

  if (family === "ALGEBRA" && !hasSymbolicObjectiveEvidence(text, input)) {
    reasons.push("Worked example does not include the required algebraic symbols or representations.");
  }

  if (isSecondary) {
    const primaryOnlySignals = [
      "counters",
      "number bonds",
      "part-whole",
      "equal groups",
      "draw four boxes",
      "count the objects",
      "ones and tens",
    ];
    const hasPrimaryOnlySignals = hasAny(text, primaryOnlySignals);
    const hasTargetDomainSignals = markers.length === 0 || hasAny(text, markers);
    if (hasPrimaryOnlySignals && !hasTargetDomainSignals) {
      reasons.push("Worked example has dropped to a lower-key-stage prerequisite without the target mathematics.");
    }
  }

  return reasons;
}

function supportList(input: GenerateNeuroTeachingInput): string[] {
  const supports = [
    "short steps",
    "single focus at a time",
    "predictable language",
    "answer-safe encouragement",
  ];
  if (input.learnerProfile.presentation.lowStimulus) supports.push("low visual noise");
  if (input.learnerProfile.presentation.frequentCheckIns) supports.push("frequent confidence checks");
  if (input.learnerProfile.presentation.moreExamples) supports.push("extra model before independent attempt");
  if (input.learnerProfile.presentation.avoidMetaphors) supports.push("literal language");
  return supports;
}

function extractVocabulary(chunks: TeachingChunk[]): Array<{ term: string; childDefinition: string }> {
  const entries: Array<{ term: string; childDefinition: string }> = [];
  const blockedTerms = [
    "oak url",
    "oak lesson assets",
    "made with",
    "quiz for lesson",
    "http",
    "https",
  ];
  for (const chunk of chunks) {
    const lines = chunkText(chunk).split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*[-•]?\s*([^—:-]{2,40})\s*[—:-]\s*(.{8,180})$/);
      if (!match) continue;
      const term = clean(match[1]).replace(/^Keywords?$/i, "");
      const childDefinition = clean(match[2]);
      if (!term || !childDefinition) continue;
      const combined = `${term} ${childDefinition}`.toLowerCase();
      if (blockedTerms.some((blocked) => combined.includes(blocked))) continue;
      if (entries.some((entry) => entry.term.toLowerCase() === term.toLowerCase())) continue;
      entries.push({ term, childDefinition });
      if (entries.length >= 4) return entries;
    }
  }
  return entries;
}

function trustedVocabulary(input: GenerateNeuroTeachingInput): Array<{ term: string; childDefinition: string }> {
  const text = [objectiveText(input), input.canonicalQuestions.map(questionText).join("\n")].join("\n");
  const entries: Array<{ term: string; childDefinition: string }> = [];
  const add = (term: string, childDefinition: string) => {
    if (!entries.some((entry) => entry.term.toLowerCase() === term.toLowerCase())) {
      entries.push({ term, childDefinition });
    }
  };

  if (hasAny(text, ["triangle", "triangles"])) {
    add("triangle", "A 2D shape with three straight sides and three angles.");
    add("side", "One straight edge of a shape.");
    add("angle", "The amount of turn between two sides.");
  }
  if (hasAny(text, ["vertex", "vertices", "corner"])) {
    add("vertex", "A corner point where sides or edges meet.");
  }
  if (hasAny(text, ["congruent", "congruence"])) {
    add("congruent", "Exactly the same shape and size.");
    add("corresponding", "Matching parts in two shapes.");
  }
  if (hasAny(text, ["sss", "side side side"])) {
    add("SSS", "Side-side-side: three matching side lengths prove triangles are congruent.");
  }
  if (hasAny(text, ["right-angled", "right angled", "right angle", "90"])) {
    add("right angle", "An angle of 90 degrees.");
  }
  if (hasAny(text, ["regular", "hexagon", "polygon"])) {
    add("regular polygon", "A polygon with all sides equal and all angles equal.");
  }
  if (hasAny(text, ["perimeter"])) {
    add("perimeter", "The total distance around the outside of a shape.");
  }
  if (hasAny(text, ["pythagoras", "pythagorean"])) {
    add("Pythagoras' theorem", "In a right-angled triangle, the square on the hypotenuse equals the sum of the squares on the other two sides.");
    add("hypotenuse", "The longest side of a right-angled triangle, opposite the right angle.");
  }
  if (hasAny(text, ["opposite"])) {
    add("opposite", "Across from the angle or side being used.");
  }
  if (hasAny(text, ["adjacent"])) {
    add("adjacent", "Next to the angle being used, but not the hypotenuse.");
  }

  if (!entries.length) {
    add(input.objective.strand, "The part of the subject we are practising in this lesson.");
  }

  return entries.slice(0, 8);
}

function fallbackCard(input: GenerateNeuroTeachingInput, fallbackReason?: string): NeuroTeachingCard {
  const chunks = relevantChunks(input.chunks);
  const firstQuestion = input.canonicalQuestions[0];
  const isTutorWorkedExample = !input.blockKey.includes("student");
  const family = classifyObjectiveFamily(input);
  const keyIdea =
    chunks[0] ? chunkText(chunks[0]).split("\n").find(Boolean) : input.objective.statement;
  const studentName = input.learnerProfile.child.displayName;
  const questionLine = firstQuestion
    ? `We will keep the question fixed: ${firstQuestion.promptText}`
    : `We are learning ${input.objective.title}.`;

  return addVisualModel({
    id: `${input.blockKey}-fallback-card`,
    blockKey: input.blockKey,
    audience: input.blockKey.includes("student") ? "STUDENT" : "TUTOR",
    title: input.blockKey.includes("student")
        ? "Personalised question support card"
        : "Worked example teaching card",
    source: "fallback",
    fallbackReason,
    chunkIds: chunks.map((chunk) => chunk.id),
    canonicalQuestionIds: input.canonicalQuestions.map((question) => question.id),
    teachingScript: isTutorWorkedExample
      ? [
          `${studentName}, we are working on ${input.objective.title}.`,
          "First, we will name what the question is asking us to find.",
          "Then we will mark the information we already know.",
          "Next, we will choose the method that uses exactly that information.",
          "I will write one line at a time and pause after each line.",
          "We will keep units visible and check whether the answer is sensible before moving on.",
        ]
      : [
          `${studentName}, we are working on ${input.objective.strand}.`,
          clean(keyIdea) || `The key idea is ${input.objective.title}.`,
          questionLine,
          "We will do one small step, check it, then move on.",
        ],
    studentFacingSummary:
      clean(keyIdea) ||
      `Today is about ${input.objective.title}. We will keep each step small and clear.`,
    keyVocabulary: extractVocabulary(chunks).length
      ? extractVocabulary(chunks)
      : trustedVocabulary(input),
    workedExample: {
      title: firstQuestion ? "Model the same structure" : input.objective.title,
      steps: isTutorWorkedExample && family === "GEOMETRY" && hasAny(objectiveText(input), ["trigonometry", "pythagoras", "triangle"])
        ? [
            "Read the whole question once without calculating.",
            "Draw or point to the right-angled triangle and mark the 90 degree angle.",
            "Mark the angle we are using, then label the sides from that angle.",
            "Write H on the hypotenuse, O on the opposite side, and A on the adjacent side.",
            "Circle what we know and underline what we need to find.",
            "Choose the ratio or theorem that links the known information to the unknown.",
            "Write the equation before substituting numbers.",
            "Substitute the values carefully and keep the unknown as a letter.",
            "Rearrange one line at a time, saying what operation has moved.",
            "Calculate, round only at the end, and write the unit.",
            "Sense-check: compare the answer with the triangle and the angle size.",
          ]
        : firstQuestion
        ? [
            `Look at the question: ${firstQuestion.promptText}`,
            "Say what is being asked before calculating.",
            "Complete one calculation step.",
            "Check the answer matches the question.",
          ]
        : [
            `Read the objective: ${input.objective.title}.`,
            "Show one clear example.",
            "Ask the learner to explain the first step.",
          ],
      answerCheck: isTutorWorkedExample && family === "GEOMETRY" && hasAny(objectiveText(input), ["trigonometry", "pythagoras", "triangle"])
        ? "The method, side labels, equation, calculation, rounding, and unit all match the triangle. The final value is checked against the size of the given angle and sides."
        : firstQuestion
        ? "Check against the fixed canonical answer after the learner has committed to an answer. Do not reveal it during prompting."
        : "The learner can explain the idea in one clear sentence.",
    },
    guidedPracticePrompts: isTutorWorkedExample
      ? [
          "Point to the angle we are using.",
          "Which side is opposite that angle?",
          "Which side is adjacent to that angle?",
          "Which side is the hypotenuse?",
          "Which method uses the two sides or side-and-angle we have?",
          "What equation should we write before calculating?",
          "What is the next algebra step?",
          "How can we check if the answer is sensible?",
        ]
      : [
          "What do we know?",
          "What is the question asking for?",
          "Which step comes first?",
        ],
    independentPrompt: firstQuestion
      ? "Now try the canonical question without changing any numbers."
      : "Now try one matching example.",
    microSteps: isTutorWorkedExample
      ? [
          "Read the question.",
          "Draw or inspect the diagram.",
          "Label the key parts.",
          "List knowns and unknown.",
          "Choose the method.",
          "Write the equation.",
          "Substitute and solve.",
          "Check the size, unit, and meaning.",
        ]
      : [
          "Name what the question is asking.",
          "Mark the important numbers or words.",
          "Choose one method and complete one step.",
          "Check the answer against the question.",
        ],
    visualModelSuggestion:
      input.objective.yearGroup != null && input.objective.yearGroup <= 4
        ? "Use counters, a part-whole model, a number line, or a simple labelled diagram."
        : "Use a clean worked example layout with one line per step.",
    checkForUnderstanding: "Ask the learner to say the next step before writing it.",
    likelyMisconception:
      firstQuestion?.rationale ||
      "The learner may know the procedure but lose the target of the question under load.",
    repairPrompt:
      firstQuestion
        ? `Keep the same question. Ask: what is the first thing this question wants us to find?`
        : "Return to the objective and ask for one example in the learner's own words.",
    stretchPrompt:
      firstQuestion
        ? "Ask the learner to explain why the method works using the same question."
        : "Ask the learner to create one similar example.",
    calmResetPrompt: "Pause. Read only the first line. Point to the number or word we need first.",
    tutorNotes: isTutorWorkedExample
      ? [
          "Keep one diagram visible throughout the model.",
          "Do not move to calculation until the sides or features are labelled.",
          "Use the same side-labelling routine every time.",
          "Pause after each written line and ask for the next micro-step.",
          "If a learner guesses the method, return to knowns and unknowns.",
          "Only remove scaffolds after the learner can explain the method choice.",
        ]
      : [
          "Keep the board uncluttered.",
          "Do not change the canonical numbers.",
          "Use wait time before adding another prompt.",
        ],
    sensoryLoad: input.learnerProfile.presentation.lowStimulus ? "LOW" : "MEDIUM",
    neurodiverseSupports: supportList(input),
  }, input);
}

function systemPrompt(input: GenerateNeuroTeachingInput): string {
  const isTutorWorkedExample = !input.blockKey.includes("student");
  return [
    "You are MyLisa's neurodiverse-aligned lesson content generator.",
    "Use retrieved curriculum chunks as teaching evidence.",
    "Canonical questions and answers are immutable source of truth.",
    "Never change canonical numbers, operators, prompt intent, answer, or difficulty.",
    "You may quote the canonical question exactly, including numbers already visible in that question.",
    "For tutor worked examples, stay at the exact objective level and use the objective's mathematical notation.",
    "Do not treat generated fallback chunks or questions as Oak source data. If Oak chunks or canonical questions are absent, keep source claims factual and use generated support only as non-Oak tutor material.",
    "Align generated support with Oak-style pedagogy: prior knowledge activation, explicit instruction, worked example, guided practice, independent practice, checks for understanding, misconception repair, and review.",
    "When a visual model is needed, specify the exact representation: chart type, axis labels, percentages/data values, diagram labels, formula layout, graph features, or table headings.",
    "For percentage composition, data, statistics, science quantities, or categorical comparisons, the visual model must be a labelled chart/table with actual values where the values are known from the objective or prompt.",
    "Do not simplify to a lower-year prerequisite unless the objective itself is that prerequisite.",
    "Keep the worked example inside the active objective's curriculum family: number, algebra, geometry, data, ratio, probability, or measure.",
    "For KS3 and KS4, do not make primary manipulatives or prerequisite-only arithmetic the main worked example unless the target objective vocabulary and method are also explicit.",
    isTutorWorkedExample
      ? "This is a tutor-facing worked-example card: include enough content for a tutor to teach without improvising missing steps."
      : "This is a student-device support card: do not reveal the final answer unless that value is already explicitly present in the canonical question text.",
    isTutorWorkedExample
      ? "For tutor cards, use this universal teaching routine: orient the learner, check prerequisite vocabulary, identify knowns/unknowns, choose the method, model each transformation, calculate, sense-check, repair likely mistakes, then set a matching try-it."
      : "For student cards, give a compact but complete scaffold: what to notice, first step, method choice, and how to check without leaking answers.",
    isTutorWorkedExample
      ? "Do not compress the worked example into a few lines. A secondary maths worked example normally needs 8-12 explicit steps."
      : "Keep learner-facing steps short, but do not skip the method choice.",
    "Write for neurodiverse children: calm tone, short steps, predictable structure, low cognitive load.",
    input.learnerProfile.presentation.avoidMetaphors
      ? "Avoid metaphors and figurative language."
      : "Use familiar context only if it reduces load.",
    "Do not over-praise. Use specific, steady encouragement.",
    "Use concise sentences, but include all necessary teaching moves. Do not use markdown. Do not repeat the input.",
    "Return JSON only.",
  ].join("\n");
}

type GenerationAttemptOptions = {
  attempt: number;
  contextMode: "full" | "question_only" | "objective_only";
  repairInstructions?: string;
};

function userPrompt(input: GenerateNeuroTeachingInput, options: GenerationAttemptOptions): string {
  const chunks = options.contextMode === "objective_only"
    ? []
    : relevantChunks(input.chunks)
        .slice(0, options.contextMode === "question_only" ? 2 : 5)
        .map(compactChunk);
  const isTutorWorkedExample = !input.blockKey.includes("student");
  const objectiveFamily = classifyObjectiveFamily(input);
  return JSON.stringify(
    {
      task: "generate_neurodiverse_aligned_teaching_card",
      generationAttempt: options.attempt,
      contextMode: options.contextMode,
      repairInstructions: options.repairInstructions ?? null,
      blockKey: input.blockKey,
      objective: input.objective,
      learnerProfile: {
        child: input.learnerProfile.child,
        presentation: input.learnerProfile.presentation,
        wrapperVectors: input.learnerProfile.wrapperVectors.slice(0, 5),
      },
      chunks,
      canonicalQuestions: input.canonicalQuestions.slice(0, 5).map((question) => ({
        id: question.id,
        sequence: question.sequence,
        promptText: question.promptText,
        answerText: question.answerText,
        difficulty: question.difficulty,
        objectiveCode: question.objectiveCode,
        strand: question.strand,
        yearGroup: question.yearGroup,
        rationale: question.rationale,
      })),
      outputContract: {
        title: "short string",
        teachingScript: isTutorWorkedExample
          ? "6-9 short spoken tutor lines: orientation, prior knowledge, task setup, method choice, calculation pacing, sense-check, confidence cue"
          : "4-6 short spoken learner-facing lines",
        studentFacingSummary: "one calm learner-facing overview",
        keyVocabulary:
          isTutorWorkedExample
            ? "4-7 objects { term, childDefinition } including method-specific words"
            : "2-5 objects { term, childDefinition }",
        workedExample:
          isTutorWorkedExample
            ? "{ title, steps: 8-12 strings. Include read/setup, diagram/representation labels, knowns, unknown, method choice, substitution, rearrangement, calculation, units, answer, and sense-check. May include the correct answer. answerCheck must explain why the answer is sensible. }"
            : "{ title, steps: 5-7 strings, answerCheck }",
        guidedPracticePrompts:
          isTutorWorkedExample
            ? "5-8 short tutor prompts ordered from identifying information to independent attempt; they may refer back to the worked answer but should still prompt thinking"
            : "3-5 short tutor prompts that do not reveal the final answer",
        independentPrompt: "what the learner should do next",
        microSteps: isTutorWorkedExample
          ? "6-8 repeatable method steps the tutor can point to during practice"
          : "4-6 short repeatable method steps",
        visualModelSuggestion:
          "specific string. Name the exact visual to show and include required labels/values. For charts include chart type, categories, values/percentages, and axis labels.",
        checkForUnderstanding: "string",
        likelyMisconception: "string",
        repairPrompt: "must not reveal the answer",
        stretchPrompt: "for secure learners",
        calmResetPrompt: "for overload or shutdown",
        tutorNotes: isTutorWorkedExample
          ? "5-8 operational tutor notes: pacing, language, board layout, wait time, error handling, when to move on"
          : "2-5 operational notes",
        sensoryLoad: "LOW | MEDIUM",
        neurodiverseSupports: "3-6 strings",
      },
      objectiveAlignmentRules: {
        exactObjective:
          "The worked example must model the named objective, not a lower-level adjacent skill.",
        keyStage:
          "Use mathematics appropriate to the objective year group and key stage.",
        objectiveFamily,
        familyVocabulary: familyMarkers(objectiveFamily),
        activeObjectiveVocabulary: targetTokens(input),
        symbolicRepresentations:
          "If the objective uses symbols, formulae, graphs, diagrams, tables, units, or statistical/probability notation, the worked example must use that representation directly.",
        noPrerequisiteDrift:
          "A prerequisite may be mentioned only as a bridge; it must not replace the active objective's method or representation.",
      },
    },
    null,
    2,
  );
}

async function callLlm(input: GenerateNeuroTeachingInput, options: GenerationAttemptOptions): Promise<NeuroTeachingCard> {
  const endpoint = azureEndpointBase();
  const deployment = clean(process.env.AZURE_OPENAI_DEPLOYMENT);
  const apiKey = clean(process.env.AZURE_OPENAI_API_KEY);
  const apiVersion = clean(process.env.AZURE_OPENAI_API_VERSION) || "2025-01-01-preview";

  const res = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(
      deployment,
    )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        max_completion_tokens: 3600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt(input) },
          { role: "user", content: userPrompt(input, options) },
        ],
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Neuro teaching LLM failed: ${res.status} ${res.statusText} ${text}`);
  }

  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("Neuro teaching LLM returned empty content");
  }

  const parsed = JSON.parse(stripJsonFence(content)) as Partial<NeuroTeachingCard>;
  const fallback = fallbackCard(input);

  return addVisualModel({
    ...fallback,
    source: "llm",
    title: clean(parsed.title) || fallback.title,
    teachingScript: Array.isArray(parsed.teachingScript)
      ? parsed.teachingScript.map(String).map(clean).filter(Boolean).slice(0, 10)
      : fallback.teachingScript,
    studentFacingSummary: clean(parsed.studentFacingSummary) || fallback.studentFacingSummary,
    keyVocabulary: Array.isArray(parsed.keyVocabulary)
      ? parsed.keyVocabulary
          .map((item) => ({
            term: clean((item as any)?.term),
            childDefinition: clean((item as any)?.childDefinition),
          }))
          .filter((item) => item.term && item.childDefinition)
          .slice(0, 8)
      : fallback.keyVocabulary,
    workedExample:
      parsed.workedExample && typeof parsed.workedExample === "object"
        ? {
            title: clean((parsed.workedExample as any).title) || fallback.workedExample.title,
            steps: Array.isArray((parsed.workedExample as any).steps)
              ? (parsed.workedExample as any).steps.map(String).map(clean).filter(Boolean).slice(0, 14)
              : fallback.workedExample.steps,
            answerCheck:
              clean((parsed.workedExample as any).answerCheck) ||
              fallback.workedExample.answerCheck,
          }
        : fallback.workedExample,
    guidedPracticePrompts: Array.isArray(parsed.guidedPracticePrompts)
      ? parsed.guidedPracticePrompts.map(String).map(clean).filter(Boolean).slice(0, 10)
      : fallback.guidedPracticePrompts,
    independentPrompt: clean(parsed.independentPrompt) || fallback.independentPrompt,
    microSteps: Array.isArray(parsed.microSteps)
      ? parsed.microSteps.map(String).map(clean).filter(Boolean).slice(0, 10)
      : fallback.microSteps,
    visualModelSuggestion: clean(parsed.visualModelSuggestion) || fallback.visualModelSuggestion,
    checkForUnderstanding: clean(parsed.checkForUnderstanding) || fallback.checkForUnderstanding,
    likelyMisconception: clean(parsed.likelyMisconception) || fallback.likelyMisconception,
    repairPrompt: clean(parsed.repairPrompt) || fallback.repairPrompt,
    stretchPrompt: clean(parsed.stretchPrompt) || fallback.stretchPrompt,
    calmResetPrompt: clean(parsed.calmResetPrompt) || fallback.calmResetPrompt,
    tutorNotes: Array.isArray(parsed.tutorNotes)
      ? parsed.tutorNotes.map(String).map(clean).filter(Boolean).slice(0, 10)
      : fallback.tutorNotes,
    sensoryLoad: parsed.sensoryLoad === "MEDIUM" ? "MEDIUM" : fallback.sensoryLoad,
    neurodiverseSupports: Array.isArray(parsed.neurodiverseSupports)
      ? parsed.neurodiverseSupports.map(String).map(clean).filter(Boolean).slice(0, 8)
      : fallback.neurodiverseSupports,
  }, input);
}

function containsLeakedAnswer(
  value: string,
  questions: CanonicalQuestion[],
  allowedVocabulary: string,
): boolean {
  const text = value.toLowerCase();
  return questions.some((question) => {
    const answer = clean(question.answerText).toLowerCase();
    if (!answer || answer.length <= 1) return false;
    if (answer === "[object object]") return false;
    if (answer.length > 80 || answer.split(/\s+/).length > 8) return false;
    if (/^https?:\/\//.test(answer)) return false;
    if (allowedVocabulary.includes(answer)) return false;
    const originalPrompt = clean(question.promptText).toLowerCase();
    if (originalPrompt.includes(answer)) return false;
    return text.includes(answer);
  });
}

function questionText(question: CanonicalQuestion): string {
  const content = asRecord(question.contentJson);
  const oak = asRecord(content?.oak);
  const choices = [
    ...asArray(content?.choices),
    ...asArray(oak?.choices),
    ...asArray(oak?.rawAnswers),
  ]
    .map((item) => JSON.stringify(item))
    .join(" ");
  return [
    question.promptText,
    question.answerText,
    question.objectiveTitle,
    question.strand,
    choices,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function requiredConceptCoverage(questions: CanonicalQuestion[]) {
  const allText = questions.map(questionText).join("\n");
  const concepts: Array<{ term: string; childDefinition: string; script: string; microStep: string }> = [];
  const add = (term: string, childDefinition: string, script: string, microStep: string) => {
    if (!concepts.some((item) => item.term.toLowerCase() === term.toLowerCase())) {
      concepts.push({ term, childDefinition, script, microStep });
    }
  };

  if (/\bnet\b|\bnets\b/.test(allText)) {
    add(
      "net",
      "A flat pattern of 2D shapes that folds to make a 3D shape.",
      "Teach net before practice: a net is a flat pattern that folds up to make a 3D shape. Point to the faces in the flat pattern, then say which solid it makes.",
      "For a net, picture folding each face up to make the solid.",
    );
  }
  if (/\bpolygon\b|\bpolygons\b/.test(allText)) {
    add(
      "polygon",
      "A closed 2D shape made only from straight sides.",
      "Teach polygon before practice: check that the shape is flat, closed, and made only from straight sides.",
      "For a polygon, check: flat, closed, straight sides.",
    );
  }
  if (/\b2d\b|2d shape|flat shape/.test(allText)) {
    add(
      "2D",
      "Flat, like a drawing on paper.",
      "Teach 2D and 3D together: 2D means flat; 3D means solid.",
      "Ask: is it flat or solid?",
    );
  }
  if (/\b3d\b|3d shape|solid|cube|cuboid|prism|pyramid|cylinder/.test(allText)) {
    add(
      "3D",
      "Solid, with faces you can count.",
      "Teach 3D shape language: faces are flat surfaces, edges are where faces meet, and vertices are corners.",
      "For a 3D shape, count faces, edges, then vertices.",
    );
  }
  if (/\bfaces?\b/.test(allText)) {
    add(
      "face",
      "A flat surface on a 3D shape.",
      "Show face, edge, vertex on one solid before asking any property questions.",
      "Point to each flat surface and count it as a face.",
    );
  }
  if (/\bedges?\b/.test(allText)) {
    add(
      "edge",
      "A line where two faces meet on a 3D shape.",
      "Show an edge as the line where two faces meet.",
      "Trace each line where faces meet to count edges.",
    );
  }
  if (/\bvertices\b|\bvertex\b|\bcorners?\b/.test(allText)) {
    add(
      "vertex",
      "A corner point where edges meet.",
      "Show a vertex as a corner point; vertices is the plural.",
      "Touch each corner point to count vertices.",
    );
  }
  if (/\bregular\b/.test(allText)) {
    add(
      "regular",
      "A regular polygon has all sides equal and all angles equal.",
      "Teach regular explicitly: equal sides and equal angles both matter.",
      "For regular, check equal sides and equal angles.",
    );
  }
  if (/\btriangle\b|\bquadrilateral\b|\bmissing angle\b|\bangle\b/.test(allText)) {
    add(
      "angle fact",
      "Angles in a triangle total 180 degrees; angles in a quadrilateral total 360 degrees.",
      "Teach the angle totals before missing-angle questions: triangle total 180 degrees, quadrilateral total 360 degrees.",
      "Add known angles, then subtract from the total.",
    );
  }

  return concepts;
}

function ensureQuestionConceptCoverage(
  card: NeuroTeachingCard,
  input: GenerateNeuroTeachingInput,
): NeuroTeachingCard {
  if (input.blockKey.includes("student")) return card;
  const concepts = requiredConceptCoverage(input.canonicalQuestions);
  if (!concepts.length) return card;

  const existingText = [
    card.title,
    card.studentFacingSummary,
    ...card.teachingScript,
    ...card.keyVocabulary.map((item) => `${item.term} ${item.childDefinition}`),
    ...card.workedExample.steps,
    ...card.microSteps,
  ]
    .join(" ")
    .toLowerCase();
  const missing = concepts.filter((concept) => !existingText.includes(concept.term.toLowerCase()));
  if (!missing.length) return card;

  return {
    ...card,
    teachingScript: [
      ...missing.map((concept) => concept.script),
      ...card.teachingScript,
    ].slice(0, 14),
    keyVocabulary: [
      ...card.keyVocabulary,
      ...missing.map(({ term, childDefinition }) => ({ term, childDefinition })),
    ]
      .filter(
        (item, index, arr) =>
          arr.findIndex((other) => other.term.toLowerCase() === item.term.toLowerCase()) === index,
      )
      .slice(0, 12),
    microSteps: [
      ...missing.map((concept) => concept.microStep),
      ...card.microSteps,
    ].slice(0, 12),
    tutorNotes: [
      "Do not start the student practice until every vocabulary item in the upcoming questions has been modelled once.",
      ...card.tutorNotes,
    ].slice(0, 10),
  };
}

function visualModelCoversConcepts(
  visualModel: VisualModel | undefined,
  concepts: Array<{ term: string }>,
): boolean {
  if (!visualModel || !concepts.length) return false;
  const visualText = [visualModel.alt, visualModel.caption, visualModel.prompt, visualModel.svg]
    .join("\n")
    .toLowerCase();
  const requiredTerms = concepts
    .map((concept) => concept.term.toLowerCase())
    .filter((term) => !["2d", "3d", "angle fact"].includes(term));
  return requiredTerms.every((term) => visualText.includes(term));
}

function materialiseInstructionalContent(
  card: NeuroTeachingCard,
  input: GenerateNeuroTeachingInput,
): NeuroTeachingCard {
  if (input.blockKey.includes("student")) return card;

  const concepts = requiredConceptCoverage(input.canonicalQuestions);
  if (!concepts.length) return card;

  const visualInstructionText = [
    card.visualModelSuggestion,
    ...card.teachingScript,
    ...card.microSteps,
  ]
    .join("\n")
    .toLowerCase();
  const asksTutorToShow = /\b(show|point to|draw|label|trace|fold|model)\b/.test(visualInstructionText);
  const existingIsUseful = visualModelCoversConcepts(card.visualModel, concepts);
  if (!asksTutorToShow && existingIsUseful) return card;

  const termList = concepts.map((concept) => concept.term).join(", ");
  const boardSuggestion = `Use the generated teaching board before practice: point to and name ${termList}. For nets, show the flat faces folding into a solid; for 3D shapes, show face, edge, and vertex; for polygons and angles, use the checklist and angle facts.`;
  const shouldReplaceVisual = !existingIsUseful;
  const nextVisualModel = shouldReplaceVisual
    ? generatedVisualModel(input, [boardSuggestion, card.visualModelSuggestion, cardText(card)].join("\n"))
    : card.visualModel;
  const rewriteVisualInstruction = (line: string) =>
    /^(show|point to|draw|label|trace|fold|model)\b/i.test(line.trim())
      ? `Use the generated teaching board: ${line.trim()}`
      : line;

  return {
    ...card,
    teachingScript: card.teachingScript.map(rewriteVisualInstruction),
    microSteps: [
      boardSuggestion,
      ...card.microSteps.map(rewriteVisualInstruction),
    ].slice(0, 12),
    visualModelSuggestion: boardSuggestion,
    visualModel: nextVisualModel,
    tutorNotes: [
      "If Oak has no relevant image, this card now includes a generated board; do not rely on verbal explanation alone.",
      ...card.tutorNotes,
    ].slice(0, 10),
  };
}

function finaliseTeachingCard(card: NeuroTeachingCard, input: GenerateNeuroTeachingInput): NeuroTeachingCard {
  return materialiseInstructionalContent(
    addVisualModel(ensureQuestionConceptCoverage(card, input), input),
    input,
  );
}

function validateGeneratedCard(
  card: NeuroTeachingCard,
  input: GenerateNeuroTeachingInput,
): GuardrailResult {
  const reasons: string[] = [];
  const isTutorWorkedExample = !input.blockKey.includes("student");
  if (card.source !== "llm") reasons.push("Card was not generated by the LLM.");
  if (card.fallbackReason) reasons.push("Card contains a fallback reason.");
  if (!card.title) reasons.push("Missing title.");
  if (card.teachingScript.length < (isTutorWorkedExample ? 5 : 3)) {
    reasons.push("Teaching script is too thin.");
  }
  if (card.microSteps.length < (isTutorWorkedExample ? 5 : 3)) {
    reasons.push("Micro steps are too thin.");
  }
  if (card.keyVocabulary.length < 1) reasons.push("Missing vocabulary.");
  if (card.workedExample.steps.length < (isTutorWorkedExample ? 7 : 4)) {
    reasons.push("Worked example is too thin.");
  }
  if (isTutorWorkedExample && card.guidedPracticePrompts.length < 4) {
    reasons.push("Guided prompts are too thin.");
  }
  if (isTutorWorkedExample && card.tutorNotes.length < 4) {
    reasons.push("Tutor notes are too thin.");
  }
  if (!card.repairPrompt) reasons.push("Missing repair prompt.");
  if (!card.calmResetPrompt) reasons.push("Missing calm reset prompt.");
  reasons.push(...validateObjectiveAlignment(card, input));

  const isStudentDeviceCard = input.blockKey.includes("student");
  if (isStudentDeviceCard) {
    const answerSensitiveText = [
      card.studentFacingSummary,
      card.independentPrompt,
      card.checkForUnderstanding,
      card.repairPrompt,
      card.calmResetPrompt,
      ...card.guidedPracticePrompts,
    ].join("\n");
    if (containsLeakedAnswer(answerSensitiveText, input.canonicalQuestions, objectiveText(input))) {
      reasons.push("Answer appears in learner-facing prompts.");
    }
  }

  const expectedQuestionIds = new Set(input.canonicalQuestions.map((question) => question.id));
  const unexpectedQuestionId = card.canonicalQuestionIds.some((id) => !expectedQuestionIds.has(id));
  if (unexpectedQuestionId) reasons.push("Card references a question outside the input set.");

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

async function readCachedCard(cacheKey: string): Promise<NeuroTeachingCard | null> {
  const delegate = generatedLessonContentDelegate();
  if (!delegate?.findUnique) return null;

  const cached = await delegate.findUnique({
    where: { cacheKey },
    select: { contentJson: true, status: true, source: true },
  });
  if (!cached || cached.status !== "APPROVED" || cached.source !== "llm") return null;
  return cached.contentJson as NeuroTeachingCard;
}

async function saveApprovedCard(input: {
  cacheKey: string;
  card: NeuroTeachingCard;
  guardrail: GuardrailResult;
  generationInput: GenerateNeuroTeachingInput;
}) {
  if (!input.generationInput.organisationId) return;
  const delegate = generatedLessonContentDelegate();
  if (!delegate?.upsert) return;

  await delegate.upsert({
    where: { cacheKey: input.cacheKey },
    update: {
      contentJson: input.card as any,
      guardrailJson: input.guardrail as any,
      source: "llm",
      status: "APPROVED",
      modelUsed: clean(process.env.AZURE_OPENAI_DEPLOYMENT),
      promptMeta: {
        chunkCount: relevantChunks(input.generationInput.chunks).length,
        questionCount: input.generationInput.canonicalQuestions.length,
        version: TEACHING_CARD_CACHE_VERSION,
      },
    },
    create: {
      organisationId: input.generationInput.organisationId,
      studentId: input.generationInput.studentId,
      objectiveId: input.generationInput.objectiveId,
      cacheKey: input.cacheKey,
      blockKey: input.card.blockKey,
      source: "llm",
      status: "APPROVED",
      contentJson: input.card as any,
      guardrailJson: input.guardrail as any,
      modelUsed: clean(process.env.AZURE_OPENAI_DEPLOYMENT),
      promptMeta: {
        chunkCount: relevantChunks(input.generationInput.chunks).length,
        questionCount: input.generationInput.canonicalQuestions.length,
        version: TEACHING_CARD_CACHE_VERSION,
      },
    },
  });
}

async function saveFailedGeneration(input: {
  cacheKey: string;
  generationInput: GenerateNeuroTeachingInput;
  attempts: Array<{ attempt: number; contextMode: string; error?: string; guardrail?: GuardrailResult }>;
}) {
  if (!input.generationInput.organisationId) return;
  const delegate = generatedLessonContentDelegate();
  if (!delegate?.upsert) return;

  const latest = input.attempts[input.attempts.length - 1];
  await delegate.upsert({
    where: { cacheKey: input.cacheKey },
    update: {
      contentJson: {
        error: latest?.error ?? "Teaching card generation failed guardrails.",
        attempts: input.attempts,
      } as any,
      guardrailJson: {
        passed: false,
        attempts: input.attempts,
      } as any,
      source: "llm",
      status: "FAILED",
      modelUsed: clean(process.env.AZURE_OPENAI_DEPLOYMENT),
      promptMeta: {
        chunkCount: relevantChunks(input.generationInput.chunks).length,
        questionCount: input.generationInput.canonicalQuestions.length,
        version: TEACHING_CARD_CACHE_VERSION,
      },
    },
    create: {
      organisationId: input.generationInput.organisationId,
      studentId: input.generationInput.studentId,
      objectiveId: input.generationInput.objectiveId,
      cacheKey: input.cacheKey,
      blockKey: input.generationInput.blockKey,
      source: "llm",
      status: "FAILED",
      contentJson: {
        error: latest?.error ?? "Teaching card generation failed guardrails.",
        attempts: input.attempts,
      } as any,
      guardrailJson: {
        passed: false,
        attempts: input.attempts,
      } as any,
      modelUsed: clean(process.env.AZURE_OPENAI_DEPLOYMENT),
      promptMeta: {
        chunkCount: relevantChunks(input.generationInput.chunks).length,
        questionCount: input.generationInput.canonicalQuestions.length,
        version: TEACHING_CARD_CACHE_VERSION,
      },
    },
  });
}

function repairInstructionFor(guardrail: GuardrailResult): string {
  return [
    "Previous attempt failed guardrails.",
    ...guardrail.reasons.map((reason) => `Failure: ${reason}`),
    "Regenerate the whole card. Do not copy the failed wording.",
    "For student-device cards, do not include final answers, answer aliases, option labels that identify the answer, or completed calculations in learner-facing fields.",
    "Do include concrete vocabulary and method prompts from the active objective and visible question wording.",
  ].join("\n");
}

export async function generateNeuroTeachingCard(
  input: GenerateNeuroTeachingInput,
): Promise<NeuroTeachingCard> {
  const cacheKey = cacheKeyFor(input);
  const cached = await readCachedCard(cacheKey);
  if (cached) return finaliseTeachingCard({ ...cached, source: "llm" }, input);

  if (!hasLlmConfig()) {
    throw new Error("Teaching card generation requires Azure OpenAI configuration; fallback content is disabled.");
  }

  const attempts: GenerationAttemptOptions[] = [
    { attempt: 1, contextMode: "full" },
    { attempt: 2, contextMode: "question_only" },
    { attempt: 3, contextMode: "objective_only" },
  ];
  const debugAttempts: Array<{ attempt: number; contextMode: string; error?: string; guardrail?: GuardrailResult }> = [];
  let repairInstructions: string | undefined;

  for (const attempt of attempts) {
    try {
      const card = await callLlm(input, {
        ...attempt,
        repairInstructions,
      });
      const guardrail = validateGeneratedCard(card, input);
      debugAttempts.push({
        attempt: attempt.attempt,
        contextMode: attempt.contextMode,
        guardrail,
      });
      if (guardrail.passed) {
        await saveApprovedCard({ cacheKey, card, guardrail, generationInput: input });
        return finaliseTeachingCard(card, input);
      }
      repairInstructions = repairInstructionFor(guardrail);
    } catch (error) {
      debugAttempts.push({
        attempt: attempt.attempt,
        contextMode: attempt.contextMode,
        error: error instanceof Error ? error.message.slice(0, 500) : "LLM generation failed",
      });
      repairInstructions = [
        "Previous attempt failed before approval.",
        error instanceof Error ? error.message.slice(0, 500) : "LLM generation failed.",
        "Regenerate with a smaller, objective-led context and satisfy the output contract exactly.",
      ].join("\n");
    }
  }

  await saveFailedGeneration({ cacheKey, generationInput: input, attempts: debugAttempts });
  const latest = debugAttempts[debugAttempts.length - 1];
  const reason = latest?.guardrail?.reasons.join(" | ") || latest?.error || "Unknown generation failure";
  throw new Error(`Teaching card generation failed after ${debugAttempts.length} attempts: ${reason}`);
}

export async function generateNeuroTeachingCards(input: {
  screenPayload: any;
}): Promise<NeuroTeachingCard[]> {
  const payload = input.screenPayload;
  const objectiveBundle = Array.isArray(payload.objectives)
    ? payload.objectives.map((objective: any) => ({
        code: String(objective.code ?? ""),
        title: String(objective.title ?? ""),
        strand: String(objective.strand ?? ""),
        role: String(objective.role ?? "WORKED_EXAMPLE"),
        yearGroup:
          typeof objective.yearGroup === "number" ? objective.yearGroup : null,
        statement: String(objective.statement ?? ""),
      }))
    : [];
  const objective = {
    code: String(payload.objective?.code ?? ""),
    title: String(payload.objective?.title ?? ""),
    strand: String(payload.objective?.strand ?? ""),
    yearGroup:
      typeof payload.objective?.yearGroup === "number" ? payload.objective.yearGroup : null,
    statement: [
      String(payload.objective?.statement ?? ""),
      objectiveBundle.length > 1
        ? `Session objectives: ${objectiveBundle
            .map((item: any) => `${item.role}: ${item.title}`)
            .join(" | ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
  const learnerProfile: LearnerProfile = {
    child: payload.child,
    presentation: payload.presentation,
    wrapperVectors: payload.wrapperVectors ?? [],
  };
  const supportChunks = (payload.supportCards ?? []).flatMap((group: any) =>
    (group.items ?? []).map((item: any) => ({
      ...item,
      type: group.type,
      content: Array.isArray(item.excerpt) ? item.excerpt.join("\n") : "",
    })),
  );
  const canonicalQuestions = payload.canonicalCards ?? [];
  const roundQuestions = (payload.personalisedQuestionRounds ?? []).flatMap((round: any) =>
    (round.questions ?? []).map((question: any) => ({
      ...question,
      sequence: question.sequence ?? 0,
    })),
  );
  const supportChunkById = new Map(supportChunks.map((chunk: any) => [String(chunk.id), chunk]));
  const blockScopedChunks = (block: any) => {
    const ids = Array.isArray(block.chunkIds) ? block.chunkIds.map(String) : [];
    const scoped = ids
      .map((id: string) => supportChunkById.get(id))
      .filter(Boolean);
    return scoped.length ? scoped : supportChunks;
  };
  const blockScopedQuestions = (block: any, blockIndex: number) => {
    const blockKey = String(block.key ?? "");
    const questionIds = Array.isArray(block.canonicalQuestionIds)
      ? new Set(block.canonicalQuestionIds.map(String))
      : new Set<string>();
    const objectiveCodes = Array.isArray(block.objectiveCodes)
      ? new Set(block.objectiveCodes.map(String))
      : new Set<string>();

    if (blockKey.includes("student")) {
      return roundQuestions.filter((question: any) => questionIds.has(String(question.id)));
    }

    const nextPracticeBlock = blocks
      .slice(blockIndex + 1)
      .find((candidate: any) => String(candidate?.key ?? "").includes("student"));
    if (nextPracticeBlock) {
      const nextQuestionIds = Array.isArray(nextPracticeBlock.canonicalQuestionIds)
        ? new Set(nextPracticeBlock.canonicalQuestionIds.map(String))
        : new Set<string>();
      const upcomingQuestions = roundQuestions.filter((question: any) =>
        nextQuestionIds.has(String(question.id)),
      );
      if (upcomingQuestions.length) return upcomingQuestions;
    }

    if (objectiveCodes.size) {
      const objectiveScoped = canonicalQuestions.filter((question: any) =>
        objectiveCodes.has(String(question.objectiveCode ?? "")),
      );
      if (objectiveScoped.length) return objectiveScoped;
    }

    return canonicalQuestions;
  };
  const blockScopedObjective = (block: any) => {
    const objectiveCodes = Array.isArray(block.objectiveCodes)
      ? block.objectiveCodes.map(String)
      : [];
    const blockObjective = objectiveBundle.find((item: any) =>
      objectiveCodes.includes(item.code)
    );
    const activeObjective = blockObjective
      ? {
          code: blockObjective.code,
          title: blockObjective.title,
          strand: blockObjective.strand,
          yearGroup: blockObjective.yearGroup,
          statement: blockObjective.statement,
        }
      : objective;

    return {
      ...activeObjective,
      statement: [
        activeObjective.statement,
        `Active lesson block: ${String(block.title ?? block.key ?? "")}.`,
        "Focus this card on one clear tutor-worked example: setup, method, steps, answer check, likely misconception, and a matching guided prompt.",
        Array.isArray(block.objectiveCodes) && block.objectiveCodes.length
          ? `Block objective codes: ${block.objectiveCodes.join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  };

  const blocks = payload.lessonFlow?.sessionBlocks ?? [];
  const cards = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const blockQuestions = blockScopedQuestions(block, blockIndex);
    cards.push(
      await generateNeuroTeachingCard({
        blockKey: block.key,
        organisationId: payload.organisation?.id ?? payload.objective?.organisationId ?? null,
        studentId: payload.child?.id ?? null,
        objectiveId: payload.objective?.id ?? null,
        objective: blockScopedObjective(block),
        chunks: blockScopedChunks(block),
        canonicalQuestions: blockQuestions,
        learnerProfile,
      }),
    );
  }

  return cards;
}
