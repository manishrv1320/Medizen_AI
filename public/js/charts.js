// Chart.js wrapper: ink-coloured lines labelled directly at their ends (no legend),
// a quiet grid, and an optional shaded "normal range" band.

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const normalBand = {
  id: 'normalBand',
  beforeDatasetsDraw(chart, _args, opts) {
    if (opts?.low == null && opts?.high == null) return;
    const { ctx, chartArea, scales: { y } } = chart;
    const top = opts.high != null ? Math.max(y.getPixelForValue(opts.high), chartArea.top) : chartArea.top;
    const bottom = opts.low != null ? Math.min(y.getPixelForValue(opts.low), chartArea.bottom) : chartArea.bottom;
    if (bottom <= top) return;
    ctx.save();
    ctx.fillStyle = opts.color;
    ctx.fillRect(chartArea.left, top, chartArea.right - chartArea.left, bottom - top);
    ctx.fillStyle = opts.textColor;
    ctx.font = `500 11px ${css('--sans')}`;
    ctx.fillText('normal range', chartArea.left + 6, top + 13);
    ctx.restore();
  },
};

// Writes each series' name and last value just past the end of its line.
const endLabels = {
  id: 'endLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    ctx.save();
    ctx.font = `600 11.5px ${css('--sans')}`;
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      const points = meta.data.filter((_, j) => ds.data[j] != null);
      const last = points.at(-1);
      if (!last) return;
      const value = ds.data.filter((v) => v != null).at(-1);
      ctx.fillStyle = ds.borderColor;
      ctx.fillText(`${ds.label} ${value}`, last.x + 8, last.y);
    });
    ctx.restore();
  },
};

/**
 * lineChart(canvas, { labels, series: [{ label, data, color? }], band: { low, high }, unit })
 * Returns the Chart instance (call .destroy() when the page unmounts).
 */
export function lineChart(canvas, { labels, series, band, unit = '', suggestedMin, suggestedMax }) {
  if (!window.Chart) return null;
  const palette = [css('--blue'), css('--green'), css('--watch')];
  const grid = css('--line');
  const text = css('--muted');
  const longest = Math.max(...series.map((s) => `${s.label} ${s.data.filter((v) => v != null).at(-1) ?? ''}`.length));
  return new window.Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.data,
        borderColor: s.color || palette[i % palette.length],
        backgroundColor: s.color || palette[i % palette.length],
        borderWidth: 2,
        tension: 0.3,
        pointRadius: labels.length > 12 ? 0 : 3,
        pointHoverRadius: 4,
        spanGaps: true,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { right: Math.min(130, longest * 6.6 + 12), top: 6 } },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: css('--ink'), titleColor: css('--bg'), bodyColor: css('--bg'), padding: 10, cornerRadius: 6, displayColors: false,
          callbacks: { label: (c) => `${c.dataset.label}: ${c.formattedValue} ${unit}` },
        },
        normalBand: band ? { ...band, color: `${css('--ok')}14`, textColor: `${css('--ok')}b0` } : {},
      },
      scales: {
        x: { grid: { display: false }, border: { color: grid }, ticks: { color: text, maxRotation: 0, autoSkip: true, maxTicksLimit: 6, font: { size: 11 } } },
        y: {
          grid: { color: grid, tickBorderDash: [2, 3] }, border: { display: false },
          ticks: { color: text, maxTicksLimit: 5, font: { size: 11 } }, suggestedMin, suggestedMax,
        },
      },
    },
    plugins: [normalBand, endLabels],
  });
}

export const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
