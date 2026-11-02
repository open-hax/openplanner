import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/openplanner?directConnection=true";
const client = new MongoClient(uri);

function labelSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || "label";
}

async function run() {
  await client.connect();
  const db = client.db("openplanner");
  const events = db.collection("events");
  const graphEdges = db.collection("graph_edges");

  console.log("Connected to MongoDB openplanner.");

  // 1. Fetch all distinct discord channel IDs
  const channelIds = await events.distinct("extra.channel_id", { kind: "discord.message" });
  console.log(`Found ${channelIds.length} discord channels with messages.`);

  let precededByCount = 0;
  let topicEdgeCount = 0;
  let attachmentEdgeCount = 0;

  for (const channelId of channelIds) {
    if (!channelId) continue;
    const msgs = await events
      .find({ kind: "discord.message", "extra.channel_id": channelId })
      .project({ id: 1, ts: 1, project: 1, extra: 1 })
      .sort({ ts: 1 })
      .toArray();

    const edgeOps = [];

    for (let i = 0; i < msgs.length; i++) {
      const cur = msgs[i];
      const curId = String(cur.id);

      // Preceded by previous message in channel
      if (i > 0) {
        const prev = msgs[i - 1];
        const prevId = String(prev.id);
        const edgeKey = `${curId}||${prevId}||preceded_by`;
        edgeOps.push({
          updateOne: {
            filter: { source_node_id: curId, target_node_id: prevId, edge_kind: "preceded_by" },
            update: {
              $set: {
                _id: edgeKey,
                source_node_id: curId,
                target_node_id: prevId,
                edge_kind: "preceded_by",
                layer: "conversational",
                project: cur.project || "discord",
                source: "openplanner-backfill",
                data: { channel_id: channelId, guild_id: cur.extra?.guild_id, previous_message_id: prevId },
                updated_at: new Date(cur.ts),
              },
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        });
        precededByCount++;
      }

      // Check topics
      const rawTopics = Array.isArray(cur.extra?.topics)
        ? cur.extra.topics
        : typeof cur.extra?.topic === "string"
          ? [cur.extra.topic]
          : [];
      const topics = [...new Set(rawTopics.map((t) => String(t ?? "").trim()).filter(Boolean))];
      for (const t of topics) {
        const slug = labelSlug(t);
        const topicId = `topic:${slug}`;
        const edgeKey = `${curId}||${topicId}||mentions_topic`;
        edgeOps.push({
          updateOne: {
            filter: { source_node_id: curId, target_node_id: topicId, edge_kind: "mentions_topic" },
            update: {
              $set: {
                _id: edgeKey,
                source_node_id: curId,
                target_node_id: topicId,
                edge_kind: "mentions_topic",
                layer: "semantic",
                project: cur.project || "discord",
                source: "openplanner-backfill",
                data: { topic: t, channel_id: channelId, guild_id: cur.extra?.guild_id },
                updated_at: new Date(cur.ts),
              },
              $setOnInsert: { createdAt: new Date() },
            },
            upsert: true,
          },
        });
        topicEdgeCount++;
      }

      // Check attachments
      if (Array.isArray(cur.extra?.attachments) && cur.extra.attachments.length > 0) {
        for (const att of cur.extra.attachments) {
          if (!att) continue;
          const attId = String(att.id || att.url || JSON.stringify(att));
          const attNodeId = `discord:attachment:${attId}`;
          const edgeKey = `${curId}||${attNodeId}||has_attachment`;
          edgeOps.push({
            updateOne: {
              filter: { source_node_id: curId, target_node_id: attNodeId, edge_kind: "has_attachment" },
              update: {
                $set: {
                  _id: edgeKey,
                  source_node_id: curId,
                  target_node_id: attNodeId,
                  edge_kind: "has_attachment",
                  layer: "multimodal",
                  project: cur.project || "discord",
                  source: "openplanner-backfill",
                  data: { filename: att.filename, url: att.url, content_type: att.content_type },
                  updated_at: new Date(cur.ts),
                },
                $setOnInsert: { createdAt: new Date() },
              },
              upsert: true,
            },
          });
          attachmentEdgeCount++;
        }
      }
    }

    if (edgeOps.length > 0) {
      await graphEdges.bulkWrite(edgeOps, { ordered: false });
    }
  }

  console.log(`Backfill complete:
- preceded_by edges queued/upserted: ${precededByCount}
- mentions_topic edges queued/upserted: ${topicEdgeCount}
- has_attachment edges queued/upserted: ${attachmentEdgeCount}`);

  await client.close();
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
