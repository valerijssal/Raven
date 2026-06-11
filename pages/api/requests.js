import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import { supabaseAdmin } from "../../lib/supabase";

const ASANA_PROJECT_ID = "1210527837423031";
const ASANA_SECTION_ID = "1210527837423032";

async function createAsanaTask(requestData, submittedBy) {
  const { requestType, notes, people, selectedUuids, excludeMode } = requestData;

  const peopleLines = people.map(p =>
    `• ${p.name} — ${p.roles.join(", ")}`
  ).join("\n");

  const propSummary = excludeMode
    ? `Exclude mode: ${selectedUuids.length} properties excluded`
    : `${selectedUuids.length} properties selected`;

  const taskName = `[CASS] ${requestType} — ${people.map(p => p.name).join(", ")}`;

  const description = [
    `Request type: ${requestType}`,
    `Submitted by: ${submittedBy}`,
    ``,
    `People:`,
    peopleLines,
    ``,
    `Properties: ${propSummary}`,
    notes ? `\nNotes: ${notes}` : "",
  ].filter(l => l !== undefined).join("\n");

  const res = await fetch("https://app.asana.com/api/1.0/tasks", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.ASANA_PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: {
        name: taskName,
        notes: description,
        projects: [ASANA_PROJECT_ID],
        memberships: [{ project: ASANA_PROJECT_ID, section: ASANA_SECTION_ID }],
      }
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Asana error: ${err}`);
  }

  return await res.json();
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const session = await getServerSession(req, res, authOptions);
  if (!session) return res.status(401).json({ error: "Unauthorized" });

  const { requestType, notes, people, selectedUuids, excludeMode } = req.body;

  // Save to Supabase
  const { data, error } = await supabaseAdmin
    .from("requests")
    .insert({
      submitted_by: session.user.email,
      request_type: requestType,
      notes,
      people,
      property_uuids: selectedUuids,
      exclude_mode: excludeMode,
      status: "pending",
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Create Asana task
  try {
    await createAsanaTask({ requestType, notes, people, selectedUuids, excludeMode }, session.user.email);
  } catch (asanaErr) {
    console.error("Asana task creation failed:", asanaErr.message);
    // Don't fail the whole request — Supabase save succeeded
  }

  res.status(200).json(data);
}
