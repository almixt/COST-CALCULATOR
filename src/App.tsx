// @ts-nocheck
import React, { useState, useMemo, useEffect, useRef } from "react";

/* ============================================================
   Maliyet Analizi — GYF Yıllık Sabit Gider / Toplam Gider
   ------------------------------------------------------------
   Toplam Gider = Yıllık Yönetim Ücreti + BSMV + Diğer Masraflar
     • Yıllık Yönetim Ücreti = Portföy Büyüklüğü × Yönetim Ücreti Oranı
     • BSMV                  = Yıllık Yönetim Ücreti × BSMV Oranı
     • Diğer Masraflar       = Σ (gider satırları)

   Her gider satırının HESABI (Toplam Tutar sütunu):
     • Sabit satır  → Değer × Dönem × (1 + vergi)   [Değer kutusunda ₺]
                       örn. Bağımsız Denetim: 280.000 × 1 × 1,20 = 336.000
                       örn. E-Defter: 1.184 × 12 × 1,20 = 17.049,60
     • Oran satırı  → Portföy × oran(%) × Dönem × (1 + vergi)  [Değer kutusunda %]
                       örn. SPK: 1.000.000.000 × %0,005 × 4 = 200.000
     • Boş (—)      → hesaba 0 katkı

   Dönem = bir yıl içindeki tahsil/çarpan sayısı (ay veya dönem).
   Vergi  hem Sabit hem Oran satırlarına uygulanabilir (KDV / BSMV / Yok).

   ÖNEMLİ: Temel Veriler'deki KDV ve BSMV oranları doğrudan gider
   satırlarına bağlıdır. BSMV'yi %5 → %7 yaparsan "BSMV" seçili tüm
   satırlar anında %7 ile yeniden hesaplanır.
   ============================================================ */

// --- helpers -------------------------------------------------
const num = (v) => {
  const n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  return isFinite(n) ? n : 0;
};

const tl = (x, dec = 2) =>
  !isFinite(x)
    ? "—"
    : (x + 0).toLocaleString("tr-TR", {
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      });

const groupTr = (raw) => {
  if (raw === "" || raw == null) return "";
  const neg = String(raw).trim().startsWith("-");
  const clean = String(raw).replace(/[^\d.]/g, "");
  const [int = "", dec] = clean.split(".");
  const intGrouped =
    int === ""
      ? "0"
      : Number(int).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  const out = dec != null ? `${intGrouped},${dec}` : intGrouped;
  return neg ? "-" + out : out;
};

const cleanInput = (text) =>
  String(text)
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.]/g, "");

// --- Money input: grouped when idle, plain when editing ------
function MoneyInput({ value, onChange, className }) {
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (!focused) setText(groupTr(value));
  }, [value, focused]);

  return (
    <input
      className={className}
      value={text}
      inputMode="decimal"
      onFocus={() => {
        setFocused(true);
        setText(value === "" ? "" : String(value).replace(".", ","));
      }}
      onChange={(e) => {
        setText(e.target.value);
        onChange(cleanInput(e.target.value));
      }}
      onBlur={() => {
        setFocused(false);
        setText(groupTr(value));
      }}
    />
  );
}

function RateInput({ value, onChange, className }) {
  return (
    <input
      className={className}
      value={value}
      inputMode="decimal"
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
    />
  );
}

// --- Değer cell with a fixed unit affix (₺ for fixed, % for rate) ---
function UnitField({ unit, children }) {
  return (
    <div className="unit">
      {children}
      <em className="usuf">{unit}</em>
    </div>
  );
}

// --- Help icon with a clip-proof tooltip ---------------------
function HelpIcon({ text }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const ref = useRef(null);

  if (!text) return null;

  const show = () => {
    const el = ref.current;
    if (!el) return;
    const rc = el.getBoundingClientRect();
    setPos({ x: rc.left + rc.width / 2, y: rc.top });
    setOpen(true);
  };
  const hide = () => setOpen(false);

  return (
    <span
      ref={ref}
      className="help"
      tabIndex={0}
      role="button"
      aria-label="Açıklama"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={(e) => {
        e.preventDefault();
        open ? hide() : show();
      }}
    >
      ?
      {open && (
        <span className="tip" style={{ left: pos.x, top: pos.y }}>
          {text}
        </span>
      )}
    </span>
  );
}

// ============================================================
//  DEFAULTS  (reproduce the workbook's 6.997.852,75 ₺ total)
// ============================================================
const DEFAULT_ASSUMPTIONS = {
  portfolio: "1000000000", // Portföy Büyüklüğü (TL)
  mgmtFeePct: "0,5", // Fon Yönetim Ücreti Oranı (%)
  bsmvPct: "5", // BSMV Oranı (%)
  kdvPct: "20", // KDV Oranı (%)
};

// type: "fixed" → Değer × Dönem × (1+vergi)
//       "rate"  → portföy × oran × Dönem × (1+vergi)
//       "none"  → boş (0)
// tax:   "kdv" | "bsmv" | "none"   (Sabit ve Oran satırlarında uygulanır)
// donem: bir yıldaki çarpan/dönem sayısı (varsayılan 1)
const DEFAULT_ROWS = [
  {
    name: "Bağımsız Denetim",
    payee: "Bağımsız Denetçi",
    type: "fixed",
    amount: "280000",
    donem: "1",
    tax: "kdv",
    info: "6 ayda bir,  2 taksit şeklinde ödenir",
  },
  {
    name: "Yeminli Mali Müşavirlik",
    payee: "YMM",
    type: "fixed",
    amount: "120000",
    donem: "1",
    tax: "kdv",
    info: "6 ayda bir,  2 taksit şeklinde ödenir",
  },
  {
    name: "E-Defter",
    payee: "İNFİNA",
    type: "fixed",
    amount: "1184",
    donem: "12",
    tax: "kdv",
    info: "Kullanım ücreti 6 aylık ödenir. Temmuz'da fiyat revize edilir",
  },
  {
    name: "Vergiler",
    payee: "GİB",
    type: "fixed",
    amount: "10000",
    donem: "1",
    tax: "none",
    info: "3 Dönem Geçici+1 Yıllık Kurumlar  Bildirimi Damga Vergisi. BSMV Her ay, Geçici 3 ayda bir, Kurumlar yıllık peşin ödenir",
  },
  {
    name: "Kolektif Saklama Ücreti GYF",
    payee: "İşbankası",
    type: "rate",
    rate: "0,1",
    donem: "1",
    tax: "none",
    info: "Yıllık oran, 3 Ayda bir ödenir. Büyüklük üzerinden tahakkuk eder. Aylık taban rakam:59.000 TL",
  },
  {
    name: "Takasbank Saklama Komisyonu",
    payee: "Takasbank",
    type: "none",
    amount: "0",
    donem: "1",
    tax: "none",
    info: "Gayrimenkul dışındaki varlıklar için ödenir.",
  },
  {
    name: "SPK Kurul Kayıt Ücreti",
    payee: "SPK",
    type: "rate",
    rate: "0,005",
    donem: "4",
    tax: "none",
    info: "3 Aylık orandır. Her 3. ay son iş günü fon raporu büyüklüğü üzerinden tahakkuk eder.",
  },
  {
    name: "Noter Onaylı Resmi Defter",
    payee: "Noter",
    type: "fixed",
    amount: "5003.7",
    donem: "1",
    tax: "none",
    info: "Pay alım satım ve envanter defteri, Yatırım Komitesi Karar Defteri. Peşin Ödenir. Sabit Ücret",
  },
  {
    name: "LEİ Kodu",
    payee: "Takasbank",
    type: "fixed",
    amount: "3281",
    donem: "1",
    tax: "bsmv",
    info: "Peşin Ödenir. Sabit Ücret",
  },
  {
    name: "KAP Yıllık Bakım Ücreti",
    payee: "MKK",
    type: "fixed",
    amount: "25512",
    donem: "1",
    tax: "kdv",
    info: "Peşin Ödenir. Sabit Ücret",
  },
  {
    name: "Mali Mühür",
    payee: "Kamu-SM",
    type: "fixed",
    amount: "1740",
    donem: "1",
    tax: "none",
    info: "3 yıllık alınıyor,fonda ünvan değişikliği olması durumunda tekrar başvuru ücreti ödenir. Sabit ücret, peşin ödenir",
  },
  {
    name: "KDV Ödemesi",
    payee: "GİB",
    type: "none",
    amount: "0",
    donem: "1",
    tax: "none",
    info: "Elde edilen kira gelirlerine bağlı olarak değişmekte olup zorunlu giderdir.",
  },
];

// --- the calculation ----------------------------------------
function compute(a, rows) {
  const portfolio = num(a.portfolio);
  const mgmtRate = num(a.mgmtFeePct) / 100;
  const bsmvRate = num(a.bsmvPct) / 100;
  const kdvRate = num(a.kdvPct) / 100;

  const mgmtFee = portfolio * mgmtRate; // Yıllık Yönetim Ücreti
  const bsmv = mgmtFee * bsmvRate; // BSMV

  // vergi çarpanı temel verilerdeki oranlardan gelir (bağlı)
  const taxRateOf = (tax) =>
    tax === "kdv" ? kdvRate : tax === "bsmv" ? bsmvRate : 0;

  const rowAmounts = rows.map((row) => {
    if (row.type === "none") return 0;
    // boş Dönem = 1 sayılır
    const donem = row.donem === "" || row.donem == null ? 1 : num(row.donem);
    const taxMul = 1 + taxRateOf(row.tax);
    const base =
      row.type === "rate" ? portfolio * (num(row.rate) / 100) : num(row.amount);
    return base * donem * taxMul;
  });
  const otherCosts = rowAmounts.reduce((s, v) => s + v, 0); // Diğer Masraflar

  const total = mgmtFee + bsmv + otherCosts; // Toplam Gider

  return {
    portfolio,
    mgmtRate,
    bsmvRate,
    kdvRate,
    mgmtFee,
    bsmv,
    rowAmounts,
    otherCosts,
    total,
  };
}

function App() {
  const [a, setA] = useState(DEFAULT_ASSUMPTIONS);
  const [rows, setRows] = useState(DEFAULT_ROWS);

  const r = useMemo(() => compute(a, rows), [a, rows]);

  const setAssum = (k, v) => setA((p) => ({ ...p, [k]: v }));
  const setRow = (i, k, v) =>
    setRows((p) => p.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));
  const addRow = () =>
    setRows((p) => [
      ...p,
      {
        name: "",
        payee: "",
        type: "fixed",
        amount: "0",
        donem: "1",
        tax: "none",
        info: "",
      },
    ]);
  const delRow = (i) => setRows((p) => p.filter((_, idx) => idx !== i));

  const reset = () => {
    setA({ portfolio: "0", mgmtFeePct: "0", bsmvPct: "0", kdvPct: "0" });
    setRows(
      DEFAULT_ROWS.map((row) => ({
        ...row,
        amount: "0",
        rate: "0",
        donem: "1",
      }))
    );
  };

  // composition bar segment widths (live)
  const tt = r.total > 0 ? r.total : 1;
  const segMgmt = (r.mgmtFee / tt) * 100;
  const segBsmv = (r.bsmv / tt) * 100;
  const segOther = (r.otherCosts / tt) * 100;

  return (
    <div className="root">
      <style>{CSS}</style>

      <header className="hd">
        <div className="hd-titles">
          <h1>Maliyet Analizi</h1>
          <p>GYF Yıllık Sabit Gider &amp; Toplam Gider Hesaplama</p>
        </div>
        <button className="ghost" onClick={reset}>
          Sıfırla
        </button>
      </header>

      {/* 01 — ASSUMPTIONS */}
      <section className="panel">
        <div className="sec-label">
          <span className="sec-no">01</span> Temel Veriler
        </div>
        <div className="grid">
          <Field label="Portföy Büyüklüğü" hint="Portfolio size" suffix="₺">
            <MoneyInput
              value={a.portfolio}
              onChange={(v) => setAssum("portfolio", v)}
            />
          </Field>
          <Field
            label="Yönetim Ücreti Oranı"
            hint="Management fee rate"
            suffix="%"
          >
            <RateInput
              value={a.mgmtFeePct}
              onChange={(v) => setAssum("mgmtFeePct", v)}
            />
          </Field>
          <Field label="BSMV Oranı" hint="BSMV rate" suffix="%">
            <RateInput
              value={a.bsmvPct}
              onChange={(v) => setAssum("bsmvPct", v)}
            />
          </Field>
          <Field label="KDV Oranı" hint="VAT rate" suffix="%">
            <RateInput
              value={a.kdvPct}
              onChange={(v) => setAssum("kdvPct", v)}
            />
          </Field>
        </div>
        <div className="derived">
          <span>
            <b>Yıllık Yönetim Ücreti</b> {tl(r.mgmtFee)} ₺
          </span>
          <span className="dot" />
          <span>
            <b>BSMV</b> {tl(r.bsmv)} ₺
          </span>
        </div>
      </section>

      {/* 02 — COST TABLE */}
      <section className="panel">
        <div className="sec-label">
          <span className="sec-no">02</span> Doğrudan Fon'dan Karşılanan
          Giderler
          <button className="add" onClick={addRow}>
            + Satır Ekle
          </button>
        </div>

        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th className="rownum"></th>
                <th className="edit">Gider Adı</th>
                <th className="edit">Tahsil Eden</th>
                <th className="edit ctr">Tür</th>
                <th className="edit ctr">Dönem</th>
                <th className="edit num">Değer</th>
                <th className="edit ctr">Vergi</th>
                <th className="num key">Toplam Tutar (₺)</th>
                <th className="del"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  <td className="rownum">{i + 1}</td>
                  <td className="edit">
                    <div className="namecell">
                      <input
                        value={row.name}
                        placeholder="Gider adı"
                        onChange={(e) => setRow(i, "name", e.target.value)}
                      />
                      <HelpIcon text={row.info} />
                    </div>
                  </td>
                  <td className="edit">
                    <input
                      value={row.payee}
                      placeholder="—"
                      onChange={(e) => setRow(i, "payee", e.target.value)}
                    />
                  </td>
                  <td className="edit ctr">
                    <select
                      className="sel"
                      value={row.type}
                      onChange={(e) => setRow(i, "type", e.target.value)}
                    >
                      <option value="fixed">Sabit</option>
                      <option value="rate">Oran</option>
                      <option value="none">— (Boş)</option>
                    </select>
                  </td>
                  <td className="edit ctr">
                    {row.type === "none" ? (
                      <span className="dash">—</span>
                    ) : (
                      <RateInput
                        className="donemin"
                        value={row.donem ?? "1"}
                        onChange={(v) => setRow(i, "donem", v)}
                      />
                    )}
                  </td>
                  <td className="edit num">
                    {row.type === "rate" ? (
                      <UnitField unit="%">
                        <RateInput
                          className="ri uin"
                          value={row.rate || ""}
                          onChange={(v) => setRow(i, "rate", v)}
                        />
                      </UnitField>
                    ) : row.type === "fixed" ? (
                      <UnitField unit="₺">
                        <MoneyInput
                          className="ri uin"
                          value={row.amount || ""}
                          onChange={(v) => setRow(i, "amount", v)}
                        />
                      </UnitField>
                    ) : (
                      <span className="dash">—</span>
                    )}
                  </td>
                  <td className="edit ctr">
                    {row.type === "none" ? (
                      <span className="dash">—</span>
                    ) : (
                      <select
                        className="sel"
                        value={row.tax || "none"}
                        onChange={(e) => setRow(i, "tax", e.target.value)}
                      >
                        <option value="kdv">KDV</option>
                        <option value="bsmv">BSMV</option>
                        <option value="none">Yok</option>
                      </select>
                    )}
                  </td>
                  <td className="num key">
                    <span className="mny">{tl(r.rowAmounts[i])}</span>
                  </td>
                  <td className="del">
                    <button
                      onClick={() => delRow(i)}
                      disabled={rows.length <= 1}
                      title="Satırı sil"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td></td>
                <td colSpan={5} className="foot-l">
                  Diğer Masraflar Toplamı
                </td>
                <td className="num"></td>
                <td className="num key">
                  <span className="mny">{tl(r.otherCosts)}</span> ₺
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* RESULT TAPE — live readout + composition bar */}
      <div className="tape">
        <div className="tape-in">
          <div className="tape-total">
            <span className="tt-label">
              <span className="live" /> Toplam Gider
            </span>
            <span className="tt-value">
              <span className="mny">{tl(r.total)}</span> ₺
            </span>
          </div>

          <div className="tape-right">
            <div
              className="compbar"
              role="img"
              aria-label="Toplam giderin bileşenlere oranı"
            >
              <i className="seg sg1" style={{ width: segMgmt + "%" }} />
              <i className="seg sg2" style={{ width: segBsmv + "%" }} />
              <i className="seg sg3" style={{ width: segOther + "%" }} />
            </div>
            <div className="legend">
              <span className="lg">
                <i className="dot sg1" />
                Yönetim Ücreti <b>{tl(r.mgmtFee, 0)} ₺</b>
              </span>
              <span className="lg">
                <i className="dot sg2" />
                BSMV <b>{tl(r.bsmv, 0)} ₺</b>
              </span>
              <span className="lg">
                <i className="dot sg3" />
                Diğer Masraflar <b>{tl(r.otherCosts, 0)} ₺</b>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, suffix, children }) {
  return (
    <label className="field">
      <span className="fl">
        {label}
        <i>{hint}</i>
      </span>
      <span className="fi">
        {children}
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');

:root{
  /* porcelain + petrol-blue + warm gold — a fund-ops instrument panel */
  --bg:#E9ECF0; --panel:#FFFFFF; --line:#E0E4EA; --line2:#EEF0F4;
  --ink:#16202E; --ink2:#586374; --ink3:#929BA8;
  --accent:#1C5D7A; --accent-d:#123F54; --accent-soft:rgba(28,93,122,.08);
  --bsmv:#4E97A8; --gold:#BE8A2E; --gold-l:#E7BE61; --rust:#B0492B;
  --shadow:0 1px 2px rgba(20,32,46,.04), 0 6px 16px rgba(20,32,46,.05), 0 24px 50px -18px rgba(20,32,46,.12);
}
*{box-sizing:border-box}
.root{
  font-family:'Inter',system-ui,sans-serif;
  background:
    radial-gradient(900px 460px at 92% -10%, rgba(28,93,122,.10), transparent 62%),
    radial-gradient(720px 380px at -6% 8%, rgba(190,138,46,.07), transparent 58%),
    var(--bg);
  color:var(--ink); min-height:100vh; padding:34px 22px 184px; line-height:1.45;
}
.root *::selection{background:rgba(28,93,122,.18)}

/* header */
.hd{display:flex;align-items:flex-end;gap:18px;max-width:1100px;margin:0 auto 26px}
.hd-titles{flex:1}
.eyebrow{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:10.5px;font-weight:600;
  letter-spacing:.26em;text-transform:uppercase;color:var(--accent);margin-bottom:10px;
  padding:4px 9px;border:1px solid var(--line);border-radius:100px;background:var(--panel)}
.hd-titles h1{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:38px;
  letter-spacing:-.025em;margin:0;line-height:.98;color:var(--ink)}
.hd-titles p{margin:8px 0 0;color:var(--ink2);font-size:13.5px}
.ghost{
  font-family:'Inter';font-size:12.5px;font-weight:500;color:var(--ink2);background:var(--panel);
  border:1px solid var(--line);border-radius:9px;padding:10px 15px;cursor:pointer;transition:.16s;white-space:nowrap;
}
.ghost:hover{border-color:var(--accent);color:var(--accent-d);box-shadow:0 2px 10px rgba(28,93,122,.12)}
.ghost:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* panels */
.panel{
  max-width:1100px;margin:0 auto 20px;background:var(--panel);
  border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:24px 26px;
  animation:rise .5s cubic-bezier(.2,.7,.2,1) both;
}
.panel:nth-of-type(2){animation-delay:.06s}
.sec-label{
  display:flex;align-items:center;gap:11px;font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:17px;
  margin:0 0 18px;letter-spacing:-.01em;color:var(--ink);
}
.sec-no{
  font-family:'IBM Plex Mono',monospace;font-size:11px;color:#fff;font-weight:600;
  background:var(--accent);border-radius:6px;padding:4px 7px;letter-spacing:.04em;
}
.add{
  margin-left:auto;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;
  color:#fff;background:var(--accent);border:1px solid var(--accent);
  border-radius:9px;padding:8px 13px;cursor:pointer;transition:.16s;box-shadow:0 2px 8px rgba(28,93,122,.22);
}
.add:hover{background:var(--accent-d);box-shadow:0 4px 14px rgba(28,93,122,.3)}
.add:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

/* assumptions grid */
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;align-items:end}
.field{display:flex;flex-direction:column;gap:7px}
.fl{font-size:12.5px;font-weight:600;color:var(--ink);text-align:left}
.fl i{display:block;font-style:normal;font-size:10.5px;color:var(--ink3);font-weight:400;margin-top:2px}
.fi{display:flex;align-items:stretch;padding:0;border:1px solid var(--line);border-radius:10px;background:#fff;transition:.16s;overflow:hidden;margin-top:auto}
.fi:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.fi input{flex:1 1 auto;width:100%;min-width:0;border:0;outline:0;background:transparent;padding:12px 13px;font-family:'IBM Plex Mono',monospace;font-size:14.5px;color:var(--ink);font-weight:500;text-align:right;font-variant-numeric:tabular-nums}
.fi em{flex:0 0 44px;display:flex;align-items:center;justify-content:center;font-style:normal;font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--accent-d);border-left:1px solid var(--line2);background:var(--accent-soft)}

.derived{
  display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-top:18px;padding-top:16px;
  border-top:1px dashed var(--line);font-family:'IBM Plex Mono',monospace;font-size:13px;color:var(--ink);
}
.derived b{color:var(--ink3);font-weight:500;font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;margin-right:6px}
.derived .dot{width:4px;height:4px;border-radius:50%;background:var(--line)}

/* table */
.tablewrap{overflow-x:auto;margin:0 -10px;border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:900px;font-size:12.5px}
thead th{
  font-family:'Inter';font-weight:600;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink2);
  text-align:right;padding:9px 10px;border-bottom:1.5px solid var(--ink);vertical-align:bottom;white-space:nowrap;
}
thead th.edit{color:var(--accent-d);text-align:left}
thead th.edit.num{text-align:right}
thead th.edit.ctr{text-align:center}
thead th.ctr{text-align:center}
thead th.key{color:var(--ink)}
.num{text-align:right}
.ctr{text-align:center}
tbody td{padding:0 10px;border-bottom:1px solid var(--line2);height:44px;white-space:nowrap;font-family:'IBM Plex Mono',monospace}
tbody tr{transition:background .12s}
tbody tr:nth-child(even){background:rgba(20,32,46,.014)}
tbody tr:hover{background:var(--accent-soft)}
td.rownum{font-size:11px;color:var(--ink3);text-align:center;width:30px;padding:0 4px}
td.edit{padding:4px 6px}
.namecell{display:flex;align-items:center;gap:7px}
.namecell input{flex:1 1 auto;min-width:0}
td.edit input,td.edit .sel{
  width:100%;border:1px solid transparent;border-radius:7px;background:#fff;outline:0;
  padding:8px 9px;font-family:'IBM Plex Mono',monospace;font-size:12.5px;color:var(--ink);transition:.12s;
  box-shadow:inset 0 0 0 1px var(--line);
}
td.edit input.ri{text-align:right}
td.edit input.donemin{text-align:center;max-width:62px;margin:0 auto}
td.edit input:focus,td.edit .sel:focus{box-shadow:inset 0 0 0 1px var(--accent),0 0 0 3px var(--accent-soft)}
td.edit input::placeholder{color:var(--ink3);opacity:.55}
td.edit.ctr .sel{text-align:center;text-align-last:center;cursor:pointer;font-size:11.5px;color:var(--accent-d);font-weight:600;min-width:74px}
td.edit.ctr .dash{color:var(--ink3);opacity:.5}

/* Değer cell with fixed unit affix (₺ / %) */
.unit{display:flex;align-items:stretch;border-radius:7px;background:#fff;overflow:hidden;
  box-shadow:inset 0 0 0 1px var(--line);transition:.12s}
.unit:focus-within{box-shadow:inset 0 0 0 1px var(--accent),0 0 0 3px var(--accent-soft)}
td.edit .unit input,td.edit .unit input:focus{box-shadow:none;border-radius:0;padding:8px 9px}
.unit .usuf{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-width:30px;
  padding:0 10px;font-style:normal;font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:600;
  color:var(--accent-d);border-left:1px solid var(--line);background:var(--accent-soft)}

/* help icon + tooltip (tooltip is position:fixed so it can't be clipped) */
.help{
  flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  width:18px;height:18px;border-radius:50%;border:1px solid var(--accent);
  background:var(--accent-soft);color:var(--accent-d);
  font-family:'Inter',sans-serif;font-size:10.5px;font-weight:700;line-height:1;
  cursor:help;user-select:none;transition:.12s;outline:none;
}
.help:hover,.help:focus{background:var(--accent);color:#fff}
.tip{
  position:fixed;transform:translate(-50%,calc(-100% - 9px));z-index:200;
  width:max-content;max-width:280px;white-space:normal;text-align:left;
  background:var(--ink);color:#EDEFF4;border:1px solid rgba(255,255,255,.12);
  border-radius:10px;padding:10px 13px;font-family:'Inter',sans-serif;font-size:11.5px;
  font-weight:400;line-height:1.45;letter-spacing:0;
  box-shadow:0 12px 34px rgba(20,32,46,.32);pointer-events:none;
}
.tip::after{
  content:"";position:absolute;top:100%;left:50%;transform:translateX(-50%);
  border:6px solid transparent;border-top-color:var(--ink);
}

td.key{background:rgba(28,93,122,.05);font-weight:600}
.mny{color:var(--ink);font-variant-numeric:tabular-nums}
.num.key .mny{color:var(--accent-d)}

td.del{width:38px;text-align:center;padding:0}
td.del button{
  width:24px;height:24px;border-radius:7px;border:1px solid transparent;background:transparent;
  color:var(--ink3);font-size:17px;cursor:pointer;line-height:1;transition:.12s;
}
td.del button:hover:not(:disabled){background:rgba(176,73,43,.12);color:var(--rust)}
td.del button:disabled{opacity:.25;cursor:not-allowed}
td.del button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
tfoot td{padding:14px 10px;border-top:2px solid var(--ink);font-family:'IBM Plex Mono',monospace;font-size:14px}
tfoot .foot-l{font-family:'Inter';font-weight:600;font-size:10.5px;letter-spacing:.05em;text-align:right;color:var(--ink2);text-transform:uppercase}

/* result tape — live readout + composition bar (signature) */
.tape{position:fixed;left:0;right:0;bottom:0;z-index:50;
  background:linear-gradient(180deg, rgba(18,28,40,0), #131D29 26%) padding-box, #131D29;
  border-top:1px solid rgba(231,190,97,.5);box-shadow:0 -12px 44px rgba(20,32,46,.26);
}
.tape-in{max-width:1100px;margin:0 auto;display:flex;align-items:center;gap:30px;padding:16px 24px;flex-wrap:wrap}
.tape-total{display:flex;flex-direction:column;gap:3px;flex:0 0 auto}
.tt-label{display:flex;align-items:center;gap:8px;font-family:'Inter';font-size:10.5px;font-weight:600;
  letter-spacing:.12em;text-transform:uppercase;color:#9aa6b4}
.tt-value{font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:30px;color:#eef1f5;
  letter-spacing:-.01em;line-height:1.05;font-variant-numeric:tabular-nums}
.tt-value .mny{color:inherit}
.live{width:7px;height:7px;border-radius:50%;background:var(--gold-l);box-shadow:0 0 0 0 rgba(231,190,97,.6);animation:pulse 2s infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(231,190,97,.5)}70%{box-shadow:0 0 0 7px rgba(231,190,97,0)}100%{box-shadow:0 0 0 0 rgba(231,190,97,0)}}
@keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}

.tape-right{flex:1 1 360px;display:flex;flex-direction:column;gap:11px;min-width:280px}
.compbar{display:flex;height:11px;border-radius:100px;overflow:hidden;background:rgba(255,255,255,.08)}
.compbar .seg{height:100%;transition:width .45s cubic-bezier(.2,.7,.2,1)}
.seg.sg1,.dot.sg1{background:var(--accent)}
.seg.sg2,.dot.sg2{background:var(--bsmv)}
.seg.sg3,.dot.sg3{background:var(--gold)}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-family:'Inter';font-size:11.5px;color:#aeb8c5}
.legend .lg{display:inline-flex;align-items:center;gap:7px}
.legend .dot{width:9px;height:9px;border-radius:3px;flex:0 0 auto}
.legend b{font-family:'IBM Plex Mono',monospace;font-weight:600;color:#eef1f5;font-variant-numeric:tabular-nums}

@media(max-width:760px){
  .hd-titles h1{font-size:29px}
  .tape-in{gap:14px;padding:13px 18px}
  .tt-value{font-size:25px}
  .tape-right{flex-basis:100%}
}
@media(prefers-reduced-motion:reduce){
  *{animation:none !important;transition:none !important}
}
`;

export default App;
