// ======================== IMPORTS ========================
import pkg from "@adiwajshing/baileys";
const { makeWASocket, useMultiFileAuthState } = pkg;

import qrcode from "qrcode-terminal";
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();
const app = express();

// ======================== MONGODB ========================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Conectado ao MongoDB Atlas"))
  .catch(err => console.error("❌ Erro MongoDB:", err));

const messageSchema = new mongoose.Schema({
  from: String,
  text: String,
  step: Number,
  tipo: String,
  peso: String,
  local: String,
  timestamp: { type: Date, default: Date.now }
});

const Message = mongoose.model("Message", messageSchema);

// ======================== EXPRESS ========================
app.get("/", async (req, res) => {
  const totalClients = await Message.distinct("from");
  res.send(`🤖 Bot WhatsApp ativo na Render<br>Clientes atendidos: ${totalClients.length}`);
});

app.get("/relatorio", async (req, res) => {
  const clientes = await Message.aggregate([
    { $sort: { timestamp: -1 } },
    { $group: { _id: "$from", tipo: { $last: "$tipo" }, peso: { $last: "$peso" }, local: { $last: "$local" } } }
  ]);
  res.json(clientes);
});

// ======================== BOT ========================
const startBot = async () => {
  // Cria auth/ automaticamente se não existir
  if (!fs.existsSync("./auth")) fs.mkdirSync("./auth");

  const { state, saveCreds } = await useMultiFileAuthState("./auth");
  const sock = makeWASocket({ auth: state });

  sock.ev.on("connection.update", ({ connection, qr }) => {
    if (qr) {
      console.log("📲 Escaneie o QR abaixo para conectar:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "open") console.log("✅ Bot conectado ao WhatsApp");
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation?.trim().toLowerCase();

    console.log("📩 Mensagem recebida:", text);

    // Buscar última mensagem do usuário
    let lastMsg = await Message.findOne({ from }).sort({ timestamp: -1 });
    let step = lastMsg?.step || 0;

    // Comando para reiniciar atendimento
    if (text === "oi" || text === "menu") {
      await sock.sendMessage(from, { text: "🔄 Atendimento reiniciado!" });
      await sock.sendMessage(from, { text: "Colchões Requinte, o sono perfeito 🌙\nSeja bem-vindo, todos nossos produtos estão em promoção!" });
      await sock.sendMessage(from, { text: "Qual sua preferência de Colchão?\n1 - Molas\n2 - Espumas" });
      await new Message({ from, text, step: 1 }).save();
      return;
    }

    // Função para salvar mensagem
    const saveMsg = async (stepNum, extra = {}) => {
      await new Message({ from, text, step: stepNum, ...extra }).save();
    };

    // ======================== FLUXO ========================
    switch (step) {
      case 0:
        await sock.sendMessage(from, { text: "Colchões Requinte, o sono perfeito 🌙\nSeja bem-vindo, todos nossos produtos estão em promoção!" });
        await sock.sendMessage(from, { text: "Qual sua preferência de Colchão?\n1 - Molas\n2 - Espumas" });
        await saveMsg(1);
        break;

      case 1:
        if (text === "1" || text === "2") {
          await sock.sendMessage(from, { text: "Qual peso do usuário?\n1 - Até 70 kg\n2 - De 70 kg a 90 kg\n3 - Acima de 90 kg" });
          await saveMsg(2, { tipo: text });
        } else {
          await sock.sendMessage(from, { text: "Por favor, digite 1 ou 2 para escolher o tipo de colchão." });
        }
        break;

      case 2:
        if (["1", "2", "3"].includes(text)) {
          let recomendacao = "";
          if (text === "1") recomendacao = "Indicados para até 70 kg";
          if (text === "2") recomendacao = "Indicados para 70-90 kg";
          if (text === "3") recomendacao = "Acima de 90 kg indicado Ajax 90 ou qualquer linha de molas da promoção";

          await sock.sendMessage(from, { text: recomendacao });
          await sock.sendMessage(from, { text: "Qual seu bairro e sua cidade?" });
          await saveMsg(3, { peso: text });
        } else {
          await sock.sendMessage(from, { text: "Por favor, digite 1, 2 ou 3 para informar o peso." });
        }
        break;

      case 3:
        await sock.sendMessage(from, { text: `✅ Obrigado! Recebemos seus dados:\n- Tipo de colchão: ${lastMsg.tipo}\n- Peso: ${lastMsg.peso}\n- Localização: ${text}` });
        await saveMsg(4, { local: text });
        break;

      default:
        await sock.sendMessage(from, { text: "🤖 Digite 'Oi' ou 'Menu' para reiniciar o atendimento." });
        break;
    }
  });
};

startBot();

// ======================== SERVER ========================
app.listen(process.env.PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${process.env.PORT}`);
});
