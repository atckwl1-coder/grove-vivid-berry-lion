# 🌙 NOOR — AI WhatsApp Concierge
### OPPO Experience Store Khanewal ka complete bot system
*"A landmark where every customer has a wonderful shopping experience"*

---

## 📁 Coding Structure (kya kahan hai)

```
noor-whatsapp-bot/
├── package.json              # project info + dependencies
├── .env.example              # API keys ka template (copy to .env)
├── README.md                 # yeh file
│
├── src/
│   ├── index.js              # 🚀 ENTRY POINT — server start yahan se
│   ├── config.js             # environment/keys ki settings
│   │
│   ├── routes/
│   │   └── webhook.js        # Meta webhook: verification + incoming messages
│   │
│   ├── flows/
│   │   └── router.js         # 📋 Menu, EMI, trade-in, reserve — conversation flows
│   │
│   ├── services/
│   │   ├── brain.js          # 🧠 AI DIMĀGH — language, LLM, human fallback
│   │   ├── whatsapp.js       # 📤 Meta Cloud API client (text/buttons/list/image)
│   │   ├── customers.js      # 💾 Customer memory (yaaddasht DB)
│   │   ├── catalog.js        # 📱 Live product catalog reader
│   │   ├── emi.js            # 💳 Installment calculator
│   │   ├── tradein.js        # 🔄 Purana phone exchange value
│   │   ├── media.js          # 🎤📸 Voice notes + photo AI (Phase-2)
│   │   └── governor.js       # 🛡️ ANTI-BAN GOVERNOR — sab se ehem file
│   │
│   ├── workers/
│   │   └── scheduler.js      # ⏰ 9AM owner brief + hourly quality check
│   │
│   ├── utils/
│   │   └── logger.js         # logging
│   │
│   └── data/
│       └── products.json     # 💰 PHONE PRICES — owner yahan daily update karega
│
└── data/                     # auto-created: noor-db.json (customers, consent)
```

## 🔄 Message ka safar (flow)

```
Customer message → Meta webhook → webhook.js → verify
      ↓
brain.js (NOOR ka dimagh)
      ↓
1. Voice note?   → media.js (STT) ──────────────┐
2. Photo?        → media.js (Vision AI)          │
3. "stop"?       → foran opt-out (anti-ban)      │
4. Menu/command? → flows/router.js (EMI/trade..) │
5. Kuch aur?     → LLM AI (locked to catalog)    │
      ↓                                          │
Doubt? → 👤 HUMAN HANDOFF (customer ko kabhi     │
         error nahi dikhta — zero-bug promise)   │
      ↓                                          │
whatsapp.js → reply bhejo ◄──────────────────────┘
```

## 🛡️ Anti-Ban Governor kya karta hai (governor.js)

Har marketing message se pehle 6 checks:
1. ✅ Customer ne **opt-in** kiya hai?
2. ✅ **Opt-out** to nahi?
3. ✅ **Quiet hours** (raat 9 – subah 9 PKT) to nahi?
4. ✅ **Daily cap** (1 promo/customer/day — Meta ka cap ~2 hai sab brands mila kar)
5. ✅ **Engagement score** theek hai? (kam interest = message mat bhejo)
6. ✅ **Pacing** — 1 msg/sec, kabhi spike nahi

## 🚀 Chalane ka tareeqa

```bash
npm install
cp .env.example .env    # keys bharein (ya DEMO mode mein chalta hai)
npm start
```

**DEMO mode:** keys ke baghair bhi chalta hai — replies console par print hote hain, taake aap sab test kar sakein.

**LIVE mode ke liye chahiye:**
1. Meta Developer account → WhatsApp Cloud API setup
2. Business verification (Meta Business Manager)
3. Phone number (naya SIM — store ka dedicated number)
4. `.env` mein `WHATSAPP_TOKEN` + `PHONE_NUMBER_ID`

## 🗺️ Roadmap (Phase-wise)

| Phase | Kia banega | Status |
|---|---|---|
| **1** | Webhook, menu, catalog, EMI, trade-in, reserve, Governor, owner brief | ✅ **BUNYAD TAYYAR** (yehi folder) |
| **2** | AI brain live (OpenAI/Claude), voice-note STT, photo Vision AI, IMEI check | ⏳ agla qadam |
| **3** | Campaigns + Festival Engine, Dost Card referrals, staff copilot, dashboard | 🔜 |
| **4** | Negotiation mode, watchlist/price-drop alerts, review rocket | 🔜 |

## 🤝 Agent Mode ke sath kaam kaise hoga

- Aap kahein: *"IMEI checker banao"* → main code likhunga, test karunga
- Aap kahein: *"yeh message Urdu mein change karo"* → foran update
- Har feature phase-wise add hoga — pehle test, phir live
- Files workspace mein saved hain — kabhi bhi wapas aa kar continue kar sakte hain
