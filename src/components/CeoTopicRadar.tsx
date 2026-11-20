import { useId } from "react";
import { CEO_TOPICS, type TopicReadings } from "@/lib/ceo-topics";

const center = { x: 180, y: 122 };
const radius = 88;
const rings = [25, 50, 75, 100];

function point(index: number, score: number) {
  const angle = (index * 2 * Math.PI) / CEO_TOPICS.length - Math.PI / 2;
  const distance = (score / 100) * radius;
  return { x: center.x + Math.cos(angle) * distance, y: center.y + Math.sin(angle) * distance };
}
const coords = (p: { x: number; y: number }) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

export default function CeoTopicRadar({ readings }: { readings: TopicReadings }) {
  const id = useId();
  const points = CEO_TOPICS.map(({ id }, i) =>
    readings[id] ? point(i, readings[id].score) : null,
  );
  const observed = points.filter((p) => p !== null);
  return (
    <figure className="overflow-hidden rounded-2xl bg-[#13243a] text-white">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
        <span className="text-[10px] font-bold tracking-[0.16em] text-slate-200 uppercase">
          Discussion footprint
        </span>
        <span className="rounded-full border border-slate-500 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-teal-100">
          {observed.length} / 8 topics observed
        </span>
      </div>
      <svg
        viewBox="0 0 360 247"
        className="block w-full"
        role="img"
        aria-labelledby={`${id}-title ${id}-desc`}
      >
        <title id={`${id}-title`}>CEO discussion signal radar</title>
        <desc id={`${id}-desc`}>
          Eight topic axes on a 0 to 100 scale. Dots show inferred discussion signals. Missing
          topics have no dot. Exact values follow the chart.
        </desc>
        <g fill="none" stroke="#647994" strokeWidth="1">
          {rings.map((r) => (
            <polygon key={r} points={CEO_TOPICS.map((_, i) => coords(point(i, r))).join(" ")} />
          ))}
          {CEO_TOPICS.map(({ id }, i) => {
            const end = point(i, 100);
            return (
              <line
                key={id}
                x1={center.x}
                y1={center.y}
                x2={end.x}
                y2={end.y}
                strokeDasharray={points[i] ? undefined : "3 4"}
              />
            );
          })}
        </g>
        {/* A closed area would imply a measurement on every axis. Leave gaps for unknowns. */}
        {observed.length === CEO_TOPICS.length && (
          <polygon points={observed.map(coords).join(" ")} fill="#65ebd1" fillOpacity="0.12" />
        )}
        {points.map((p, i) => {
          if (!p) return null;
          const next = points[(i + 1) % points.length];
          return (
            <g key={i} stroke="#65ebd1">
              <line x1={center.x} y1={center.y} x2={p.x} y2={p.y} strokeWidth="2" />
              {next && <line x1={p.x} y1={p.y} x2={next.x} y2={next.y} strokeWidth="2" />}
            </g>
          );
        })}
        <circle cx={center.x} cy={center.y} r="2.5" fill="#d5e0ef" />
        {CEO_TOPICS.map((topic, i) => {
          const p = points[i];
          const label = point(i, 114);
          const anchor =
            Math.abs(label.x - center.x) < 1 ? "middle" : label.x < center.x ? "end" : "start";
          return (
            <g key={topic.id}>
              {p && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="4.5"
                  fill="#65ebd1"
                  stroke="#13243a"
                  strokeWidth="1.5"
                />
              )}
              <text
                x={label.x}
                y={label.y + 4}
                textAnchor={anchor}
                fontSize="11.5"
                fontWeight="600"
                fill={p ? "#c6fff0" : "#c1cedf"}
              >
                {topic.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="border-t border-slate-600 px-4 py-2.5 text-[11px] text-slate-200">
        Center 0 · Each ring adds 25 points · Outer ring 100
      </figcaption>
    </figure>
  );
}
