import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FiscalVisualisation } from "@/lib/guidance-api";

function formatValue(value: number, unit = ""): string {
  const formatted = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2,
  }).format(value);
  if (!unit) return formatted;
  return unit === "%" ? `${formatted} %` : `${formatted} ${unit}`;
}

function shortLabel(value: string): string {
  return value.length > 16 ? `${value.slice(0, 15)}…` : value;
}

function FiscalChart({ item }: { item: Extract<FiscalVisualisation, { type: "bar" | "line" }> }) {
  const Chart = item.type === "bar" ? BarChart : LineChart;

  return (
    <figure className="rounded-xl border border-border bg-card/75 p-3 sm:p-4">
      <figcaption className="mb-3 font-display text-sm font-semibold text-ink">
        {item.title}
      </figcaption>
      <div className="h-56 w-full min-w-0" aria-label={item.title} role="img">
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={item.data} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickFormatter={shortLabel}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              interval={0}
            />
            <YAxis
              tickFormatter={(value) => formatValue(Number(value), item.unit)}
              tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={58}
            />
            <Tooltip
              cursor={{ fill: "var(--secondary)", opacity: 0.5 }}
              formatter={(value) => [formatValue(Number(value), item.unit), item.title]}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "0.75rem",
                color: "var(--foreground)",
                fontSize: "0.75rem",
              }}
            />
            {item.type === "bar" ? (
              <Bar dataKey="value" fill="var(--color-dv-serie-1)" radius={[4, 4, 0, 0]} />
            ) : (
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-dv-serie-1)"
                strokeWidth={2.5}
                dot={{ fill: "var(--color-dv-serie-1)", r: 3 }}
                activeDot={{ r: 5 }}
              />
            )}
          </Chart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>{item.title}</caption>
        <thead><tr><th>Élément</th><th>Valeur</th></tr></thead>
        <tbody>
          {item.data.map((point) => (
            <tr key={point.label}>
              <th>{point.label}</th>
              <td>{formatValue(point.value, item.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function FiscalTable({ item }: { item: Extract<FiscalVisualisation, { type: "table" }> }) {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card/75">
      <figcaption className="border-b border-border px-3 py-3 font-display text-sm font-semibold text-ink sm:px-4">
        {item.title}
      </figcaption>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-xs">
          <thead className="bg-secondary/75">
            <tr>
              {item.columns.map((column) => (
                <th key={column} scope="col" className="px-3 py-2.5 font-semibold text-ink">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {item.rows.map((row, rowIndex) => (
              <tr key={`${rowIndex}-${row[0]}`}>
                {row.map((cell, cellIndex) =>
                  cellIndex === 0 ? (
                    <th key={cellIndex} scope="row" className="px-3 py-2.5 font-medium text-ink">
                      {cell}
                    </th>
                  ) : (
                    <td key={cellIndex} className="px-3 py-2.5 text-muted-foreground">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export function FiscalVisualisations({ items }: { items?: FiscalVisualisation[] }) {
  if (!items?.length) return null;

  return (
    <div className="mt-4 space-y-3">
      {items.map((item, index) =>
        item.type === "table" ? (
          <FiscalTable key={`${item.type}-${item.title}-${index}`} item={item} />
        ) : (
          <FiscalChart key={`${item.type}-${item.title}-${index}`} item={item} />
        ),
      )}
    </div>
  );
}
