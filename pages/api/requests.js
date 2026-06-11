import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { supabaseAdmin } from "../../lib/supabase";
import PROPERTIES from "../../lib/properties";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { requestType, notes, people, selectedUuids, excludeMode } = req.body;

  const { data, error } = await supabaseAdmin
    .from("requests")
    .insert({
      submitted_by: session.user.email,
      request_type: requestType,
      notes: notes || null,
      people: people || [],
      property_uuids: selectedUuids || [],
      exclude_mode: excludeMode || false,
      status: "pending",
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message, code: error.code, details: error.details });

  // Fire Asana task async after response (best-effort)
  if (process.env.ASANA_PAT) {
    const uuidSet = new Set(selectedUuids || []);
    const matchedProps = PROPERTIES.filter(p => uuidSet.has(p.uuid));
    const propLines = matchedProps.map(p => `• ${p.title}`).join("\n");

    const taskName = `[CASS] ${requestType} — ${(people || []).map(p => p.name).join(", ")}`;

    const peopleHtml = (people || []).map(p =>
      `<li><strong>${p.name}</strong> — ${p.roles.join(", ")}</li>`
    ).join("");

    const propsHtml = matchedProps.map(p => `<li>${p.title}</li>`).join("");

    const html_text = `<body>`
      + `<strong>Request type:</strong> ${requestType}<br>`
      + `<strong>Submitted by:</strong> ${session.user.email}<br>`
      + (notes ? `<strong>Notes:</strong> ${notes}<br>` : "")
      + `<br><strong>People:</strong><ul>${peopleHtml}</ul>`
      + `<strong>${excludeMode ? "Properties to EXCLUDE" : "Properties"} (${matchedProps.length}):</strong>`
      + `<ul>${propsHtml}</ul>`
      + `</body>`;

    try {
      const asanaRes = await fetch("https://app.asana.com/api/1.0/tasks", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.ASANA_PAT}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          data: { name: taskName, html_notes: html_text, projects: ["1210527837423031"] }
        }),
      });
      if (!asanaRes.ok) {
        const errText = await asanaRes.text();
        console.error("Asana error:", errText);
      }
    } catch (err) {
      console.error("Asana fetch error:", err.message);
    }
  }

  res.status(200).json(data);
}
