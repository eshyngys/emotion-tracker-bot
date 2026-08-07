import { weekdayRu } from "./dates";
import type { Answer } from "./types";

export function buildDigest(
  dateKeys: string[],
  answers: Array<Answer | null>
): string {
  const start = dateKeys[0];
  const end = dateKeys[dateKeys.length - 1];
  const answered = answers.filter((a) => a !== null).length;

  const lines: string[] = [];
  lines.push(`# Дневник эмоций — ${start} – ${end}`);
  lines.push("");
  lines.push(`Отвечено ${answered} из ${dateKeys.length} дней.`);
  lines.push("");
  lines.push("## По дням");
  lines.push("");

  dateKeys.forEach((key, i) => {
    const answer = answers[i];
    lines.push(`### ${key} (${weekdayRu(key)})`);
    if (answer) {
      lines.push(`- **Эмоция:** ${answer.emotion || "—"}`);
      lines.push(`- **Причина:** ${answer.reason || "—"}`);
    } else {
      lines.push("- _пропущено_");
    }
    lines.push("");
  });

  lines.push("## Для обсуждения с Claude");
  lines.push("");
  lines.push(
    "Прикрепи этот файл в чат и попроси Claude заметить повторяющиеся эмоции и триггеры, " +
      "связать их с днями недели или событиями, и предложить, на что обратить внимание на следующей неделе."
  );
  lines.push("");

  return lines.join("\n");
}
