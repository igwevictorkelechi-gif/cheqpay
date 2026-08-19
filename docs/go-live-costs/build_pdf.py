"""Generate the CheqPay go-live cost estimate as a branded PDF.

    pip install reportlab pillow
    python3 docs/go-live-costs/build_pdf.py

Regenerate this whenever a vendor price changes or a quote lands for one of the
"Quote"/"Confirm" lines — editing the PDF by hand would put the document and its
source out of step.
"""

import os
import tempfile

from reportlab.lib import colors
from reportlab.lib.enums import TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(HERE, "CheqPay-Go-Live-Cost-Estimate.pdf")
SOURCE_LOGO = os.path.join(REPO, "apps", "web", "public", "cheqpay-logo.png")


def trimmed_logo():
    """The shipped logo carries a wide white margin that unbalances the header."""
    from PIL import Image, ImageChops

    im = Image.open(SOURCE_LOGO).convert("RGB")
    diff = ImageChops.difference(im, Image.new("RGB", im.size, (255, 255, 255)))
    bbox = diff.convert("L").point(lambda v: 255 if v > 12 else 0).getbbox()
    cropped = im.crop(bbox) if bbox else im
    # The source is ~1500px wide for a 58mm placement; downsampling to roughly
    # 300dpi keeps it crisp in print and takes ~700KB off the committed PDF.
    target_w = 700
    if cropped.width > target_w:
        h = round(cropped.height * target_w / cropped.width)
        cropped = cropped.resize((target_w, h), Image.LANCZOS)
    out = os.path.join(tempfile.mkdtemp(), "logo_trim.png")
    cropped.save(out)
    return out, cropped.size


LOGO, (LOGO_W, LOGO_H) = trimmed_logo()

# Brand palette, taken from apps/mobile/components/theme.ts so this document
# matches the product rather than approximating it.
BRAND = colors.HexColor("#6B5B95")
BRAND_DARK = colors.HexColor("#574A7A")
BRAND_LIGHT = colors.HexColor("#7A6AA6")
INK = colors.HexColor("#1B1726")
MUTED = colors.HexColor("#6E6880")
BORDER = colors.HexColor("#E0DDEA")
CIRCLE = colors.HexColor("#EAE7F2")
SURFACE = colors.HexColor("#F6F5FA")
AMBER = colors.HexColor("#8A6D1F")
AMBER_BG = colors.HexColor("#FBF3DF")

DOC_REF = "CP-GOLIVE-2026-01"
DOC_DATE = "1 August 2026"

PAGE_W, PAGE_H = A4
MARGIN = 16 * mm
CONTENT_W = PAGE_W - 2 * MARGIN

ss = getSampleStyleSheet()


def st(name, **kw):
    base = dict(fontName="Helvetica", fontSize=8.6, leading=12, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)


S_H1 = st("h1", fontName="Helvetica-Bold", fontSize=15, leading=19, textColor=INK)
S_SECTION = st("sec", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=colors.white)
S_LEAD = st("lead", fontSize=9.2, leading=13.6, textColor=MUTED)
S_CELL = st("cell")
S_CELL_B = st("cellb", fontName="Helvetica-Bold")
S_NOTE = st("note", fontSize=8.6, leading=12.4, textColor=MUTED)
S_SMALL = st("small", fontSize=7.6, leading=10.4, textColor=MUTED)
S_NUM = st("num", alignment=TA_RIGHT)
S_NUM_B = st("numb", fontName="Helvetica-Bold", alignment=TA_RIGHT)
S_META_K = st("mk", fontSize=7.4, leading=10, textColor=MUTED)
S_META_V = st("mv", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=INK)


def p(text, style=S_CELL):
    return Paragraph(text, style)


# --------------------------------------------------------------------------
# Page furniture
# --------------------------------------------------------------------------
def draw_page(canvas, doc):
    canvas.saveState()
    # Top brand rule
    canvas.setFillColor(BRAND)
    canvas.rect(0, PAGE_H - 5 * mm, PAGE_W, 5 * mm, stroke=0, fill=1)

    # Footer
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.5)
    canvas.line(MARGIN, 14 * mm, PAGE_W - MARGIN, 14 * mm)
    canvas.setFont("Helvetica", 7.2)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 9.5 * mm, DOC_REF)
    canvas.drawCentredString(
        PAGE_W / 2, 9.5 * mm, "Internal planning estimate — not a bill or a payment demand"
    )
    canvas.drawRightString(PAGE_W - MARGIN, 9.5 * mm, f"Page {canvas.getPageNumber()}")
    canvas.restoreState()


# --------------------------------------------------------------------------
# Building blocks
# --------------------------------------------------------------------------
def section(title, subtitle=None):
    """A full-width brand bar introducing a section."""
    inner = [[p(title, S_SECTION)]]
    t = Table(inner, colWidths=[CONTENT_W], rowHeights=[7.6 * mm])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), BRAND),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    out = [Spacer(1, 5 * mm), t]
    if subtitle:
        out.append(Spacer(1, 1.6 * mm))
        out.append(p(subtitle, S_SMALL))
    out.append(Spacer(1, 2 * mm))
    return out


def cost_table(rows, amount_header, col_ratios=(0.30, 0.44, 0.26), total=None):
    """rows: (item, detail, amount) tuples. `total`: (label, amount) or None."""
    widths = [CONTENT_W * r for r in col_ratios]
    data = [[p("Item", S_CELL_B), p("What it covers", S_CELL_B), p(amount_header, S_NUM_B)]]
    for item, detail, amount in rows:
        data.append([p(item, S_CELL_B), p(detail, S_CELL), p(amount, S_NUM)])

    style = [
        ("BACKGROUND", (0, 0), (-1, 0), CIRCLE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.7, BRAND_LIGHT),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SURFACE]),
    ]

    if total:
        label, amount = total
        data.append([p(label, S_CELL_B), p("", S_CELL), p(amount, S_NUM_B)])
        last = len(data) - 1
        style += [
            ("BACKGROUND", (0, last), (-1, last), CIRCLE),
            ("LINEABOVE", (0, last), (-1, last), 0.9, BRAND),
            ("SPAN", (0, last), (1, last)),
        ]

    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle(style))
    return t


def callout(title, body, tone="brand"):
    bg, fg, edge = (CIRCLE, INK, BRAND) if tone == "brand" else (AMBER_BG, INK, AMBER)
    inner = [
        [p(f"<b>{title}</b>", st("ct", fontSize=9, leading=12.6, textColor=fg))],
        [p(body, st("cb", fontSize=8.4, leading=12.2, textColor=fg))],
    ]
    t = Table(inner, colWidths=[CONTENT_W])
    t.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), bg),
                ("LINEBEFORE", (0, 0), (0, -1), 2.4, edge),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, 0), 7),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
                ("TOPPADDING", (0, 1), (-1, 1), 0),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 7),
            ]
        )
    )
    return t


# --------------------------------------------------------------------------
# Content
# --------------------------------------------------------------------------
story = []

# ---- Masthead -------------------------------------------------------------
logo = Image(LOGO)
logo.drawWidth = 58 * mm
logo.drawHeight = 58 * mm * (LOGO_H / LOGO_W)
logo.hAlign = "LEFT"

meta_rows = [
    [p("REFERENCE", S_META_K), p("ISSUED", S_META_K), p("PREPARED FOR", S_META_K)],
    [p(DOC_REF, S_META_V), p(DOC_DATE, S_META_V), p("CheqPay — Founder", S_META_V)],
]
meta = Table(meta_rows, colWidths=[CONTENT_W * 0.34] * 3)
meta.setStyle(
    TableStyle(
        [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("TOPPADDING", (0, 0), (-1, 0), 0),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
            ("TOPPADDING", (0, 1), (-1, 1), 0),
        ]
    )
)

head = Table(
    [[logo, p("GO-LIVE<br/>COST ESTIMATE", st("t", fontName="Helvetica-Bold", fontSize=17,
                                              leading=20, textColor=BRAND_DARK,
                                              alignment=TA_RIGHT))]],
    colWidths=[CONTENT_W * 0.55, CONTENT_W * 0.45],
)
head.setStyle(
    TableStyle(
        [
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ]
    )
)

story += [head, Spacer(1, 4 * mm)]
story.append(
    Table(
        [[""]],
        colWidths=[CONTENT_W],
        rowHeights=[0.9],
        style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), BRAND)]),
    )
)
story += [Spacer(1, 4 * mm), meta, Spacer(1, 5 * mm)]

story.append(
    callout(
        "Read this first",
        "This is a planning estimate for launching CheqPay in production — it is not an invoice from any "
        "vendor and no money is owed to anyone on the strength of this document. Vendor list prices are "
        "current published rates and are reliable. Everything under Sections E and F is <b>not</b> reliable: "
        "those figures move, are negotiated per-merchant, or depend on a regulatory category CheqPay has not "
        "yet been assigned. Treat them as placeholders to be replaced by written quotes.",
        tone="warn",
    )
)

# ---- A. Monthly infrastructure -------------------------------------------
story += section(
    "A.  Recurring infrastructure — monthly (USD)",
    "Everything here is a published list price. These are the running costs of the stack CheqPay already uses.",
)
rows_a = [
    ("Render — API service",
     "Starter instance, Frankfurt. Hosts <b>apps/api</b>. This is the line that buys the <b>static outbound "
     "IP</b> Maplerad requires for whitelisting — the reason the API leaves Vercel at all.",
     "$7.00"),
    ("Render — cron job",
     "Daily price-alert job. Replaces Vercel Cron, which does not follow the API off Vercel.",
     "~$1.00"),
    ("Vercel Pro",
     "Web app (<b>cheqpy</b>) and admin dashboard (<b>cheqpay-admin</b>). Pro is required: the Hobby tier "
     "prohibits commercial use. Billed per seat.",
     "$20.00"),
    ("Supabase Pro",
     "Postgres + Auth. Pro is not optional for a custodial ledger: the free tier auto-pauses the project and "
     "has no daily backups.",
     "$25.00"),
    ("Resend",
     "Transaction alerts, statement delivery, OTP mail. Free to 3,000 emails/month; Pro at 50,000.",
     "$0 – $20.00"),
    ("Sentry — Team",
     "Error and performance monitoring. Already wired via <b>instrumentation.ts</b>; DSN-guarded, so it is "
     "dark until paid for.",
     "$26.00"),
    ("Anthropic API",
     "In-app AI support agent. Usage-based; falls back to a static FAQ responder when unset, so this is "
     "genuinely optional at launch.",
     "~$20.00"),
    ("Expo EAS — Production <i>(optional)</i>",
     "Managed build queue and over-the-air updates. The free tier works at low build volume; the paid plan "
     "buys build concurrency and priority.",
     "$0 – $99.00"),
]
story.append(
    cost_table(rows_a, "Per month",
               total=("Monthly run rate — lean / full", "$99  –  $218"))
)

# ---- B. Annual + one-time -------------------------------------------------
story += section("B.  Store, domain and one-time technical costs")
rows_b = [
    ("Apple Developer Program",
     "Mandatory to ship on the App Store. Renews annually; a lapse pulls the app from sale.",
     "$99.00 / yr"),
    ("Google Play Developer",
     "One-time registration. Note the <b>Financial Features Declaration</b> is required for a wallet app — "
     "no fee, but it demands the licence documentation from Section E.",
     "$25.00 once"),
    ("Domain — cheqpay.com",
     "Also needed for Resend sender-domain verification (<b>MAIL_FROM</b> must be on a verified domain).",
     "~$15.00 / yr"),
    ("Independent security assessment",
     "Penetration test of the custodial flows. Not legally mandatory on day one, but a custodial wallet "
     "holding customer funds without one is an uninsurable risk, and partners increasingly ask for the report.",
     "$5,000 – $15,000"),
]
story.append(cost_table(rows_b, "Amount"))

# ---- C. Year one ----------------------------------------------------------
story += section("C.  Year-one technology total")
rows_c = [
    ("Lean configuration",
     "Free Resend and EAS tiers, no AI support agent, no security assessment. Enough to be live and correct.",
     "~$1,330"),
    ("Full configuration",
     "Every service on its paid tier, excluding the security assessment.",
     "~$2,755"),
    ("Full + security assessment",
     "Recommended for a service holding customer funds.",
     "$7,755 – $17,755"),
]
story.append(cost_table(rows_c, "Year 1"))

story.append(Spacer(1, 3 * mm))
story.append(
    callout(
        "The headline",
        "The technology is cheap — under $200 a month runs the entire platform. The cost of going live is "
        "almost entirely licensing, compliance and float, and those are the numbers this document cannot "
        "responsibly give you.",
    )
)

# ---- D. Variable / per-transaction ---------------------------------------
story += section(
    "D.  Per-transaction and usage-based — quote required",
    "These are negotiated per merchant. None can be taken from a public price list; all need a written quote.",
)
rows_d = [
    ("Maplerad — onboarding",
     "Account opening, compliance review, live-key issuance. Also the gate on NGN <b>collections</b>, which "
     "Maplerad has not yet enabled — without it users cannot fund accounts at all.",
     "Quote"),
    ("Maplerad — NGN collections",
     "Per-deposit fee on dedicated virtual accounts.",
     "Quote"),
    ("Maplerad — payouts",
     "Per-transfer fee on bank payouts and withdrawals.",
     "Quote"),
    ("Maplerad — bill payments",
     "Airtime, data, electricity, cable. Commission-based; confirm whether it is a rebate or a charge.",
     "Quote"),
    ("Maplerad — virtual cards",
     "Card issuance fee, monthly maintenance, FX markup, and any BIN sponsorship minimum. Typically the most "
     "expensive line in this table.",
     "Quote"),
    ("Dojah — KYC / BVN",
     "Per successful verification. Currently <b>KYC_PROVIDER=mock</b>; this becomes a real per-user cost the "
     "day it flips to live.",
     "Quote"),
    ("Expo push notifications",
     "Expo's push service is free at CheqPay's volume.",
     "$0"),
    ("Binance / CoinGecko price feeds",
     "Public endpoints, free tier. CoinGecko is already the fallback if Binance rate-limits.",
     "$0"),
]
story.append(cost_table(rows_d, "Cost"))

# ---- E. Regulatory --------------------------------------------------------
story += section("E.  Regulatory and compliance — Nigeria  (figures NOT verified)")
story.append(
    callout(
        "Do not budget from this section",
        "CheqPay custodies customer funds and facilitates crypto–fiat conversion, which puts it inside "
        "Nigeria's digital-asset regime. The applicable category, capital requirement and fee schedule depend "
        "on how the SEC classifies the business — a determination only Nigerian fintech counsel can make. "
        "The amounts below are deliberately left open rather than guessed at, because a wrong number here is "
        "worse than no number.",
        tone="warn",
    )
)
story.append(Spacer(1, 2.5 * mm))
rows_e = [
    ("SEC Nigeria — VASP / digital asset registration",
     "Filing, processing and registration fees for the applicable category. Confirm whether CheqPay falls "
     "under a full registration or an incubation/sandbox route — the difference is very large.",
     "Confirm"),
    ("Minimum paid-up capital",
     "Digital asset categories carry a capital floor in the hundreds of millions of naira. This is locked "
     "capital, not a fee, and is usually the single biggest barrier to launching.",
     "Confirm"),
    ("Fidelity bond / insurance",
     "Typically expressed as a percentage of paid-up capital.",
     "Confirm"),
    ("CBN position on the naira rail",
     "The NGN side runs through Maplerad's licence rather than CheqPay's. Confirm in writing that Maplerad's "
     "licence covers CheqPay's model — relying on a partner's licence without that letter is a live risk.",
     "Confirm"),
    ("NDPC registration (NDPA 2023)",
     "Data controller registration, a named Data Protection Officer, and the annual compliance audit filing. "
     "CheqPay processes BVNs, so this is not optional.",
     "Confirm"),
    ("Legal counsel",
     "Licensing application, terms of service, privacy policy, AML/CFT policy manual. Budget for a retainer, "
     "not a one-off fee.",
     "Confirm"),
    ("CAC company registration",
     "If the operating entity is not already incorporated.",
     "Confirm"),
]
story.append(cost_table(rows_e, "Amount"))

# ---- F. Working capital ---------------------------------------------------
story += section(
    "F.  Working capital — not an expense",
    "This is money that stays yours but cannot be spent on anything else. Under-sizing it is the most common "
    "way a wallet fails in its first month.",
)
rows_f = [
    ("Maplerad NGN float",
     "Prefunded balance covering payouts and bill payments between settlement cycles. Size to peak daily "
     "outflow, not average — a float that empties mid-day means failed withdrawals and a support queue.",
     "Volume-based"),
    ("Crypto liquidity (USDT)",
     "Inventory backing user buy orders. The <b>SWAP_SPREAD_BPS</b> margin (currently 150 bps) is only earned "
     "if there is inventory to sell.",
     "Volume-based"),
    ("Cashback reserve",
     "The admin-configured cashback rate is a direct cost of every transaction. At 0.5% on NGN 10m monthly "
     "volume that is NGN 50,000/month, paid out of margin.",
     "Rate × volume"),
    ("Chargeback / reversal buffer",
     "Failed payouts, reversed bills and disputed card transactions need funding before recovery.",
     "Volume-based"),
]
story.append(cost_table(rows_f, "Sizing"))

# ---- Closing summary ----
SUMMARY_TABLE = cost_table(
    [
        ("Monthly run rate",
         "Section A. Published list prices, no negotiation required. This number is firm.",
         "$99 – $218"),
        ("Year-one technology",
         "Sections A–C, excluding the security assessment. Also firm.",
         "$1,330 – $2,755"),
        ("Per-transaction economics",
         "Section D. Unknown until Maplerad and Dojah quote. Determines whether the 150 bps spread is "
         "actually profitable — this is the number that decides if the business model works.",
         "Unknown"),
        ("Licensing and capital",
         "Sections E and F. Unknown until counsel advises. Almost certainly larger than every other line on "
         "this document combined.",
         "Unknown"),
    ],
    "Amount",
)

# ---- Basis ----------------------------------------------------------------
story.append(PageBreak())
story += section("Summary — what can actually be planned today")
story.append(SUMMARY_TABLE)
story += section("Basis of estimate")
basis = [
    "<b>Scope.</b> Costs to run the CheqPay platform as it exists in this repository: Next.js API, web app, "
    "admin dashboard and Expo mobile app, with Maplerad as the payments and custody rail.",
    "<b>Currency.</b> Sections A–D are USD, as those vendors bill in USD. Section E is naira-denominated "
    "and deliberately unconverted — no exchange-rate assumption is embedded anywhere in this document.",
    "<b>Confidence.</b> Sections A–C are published list prices and are reliable. Section D is negotiated "
    "and unknowable without a quote. Section E is <b>not verified</b> and must be replaced with counsel's "
    "figures before it informs any decision.",
    "<b>Excluded.</b> Salaries, contractor time, marketing, customer support staffing, office and equipment, "
    "accountancy, and corporate tax. This covers the cost of <i>running the software and being allowed to "
    "operate</i>, nothing else.",
    "<b>Not included as a cost.</b> Section F is capital, not expenditure — it is listed because a launch "
    "plan that omits it will fail regardless of how well the technology budget is managed.",
]
for b in basis:
    story.append(Paragraph("•&nbsp;&nbsp;" + b, S_NOTE))
    story.append(Spacer(1, 2 * mm))

story.append(Spacer(1, 4 * mm))
story.append(
    callout(
        "Suggested next step",
        "Get written quotes for Section D from Maplerad and Dojah, and an engagement letter from Nigerian "
        "fintech counsel covering Section E. Until those two arrive, the only number in this document you can "
        "actually plan around is the ~$99–$218/month in Section A.",
    )
)

# --------------------------------------------------------------------------
doc = BaseDocTemplate(
    OUT,
    pagesize=A4,
    leftMargin=MARGIN,
    rightMargin=MARGIN,
    topMargin=13 * mm,
    bottomMargin=19 * mm,
    title="CheqPay — Go-Live Cost Estimate",
    author="CheqPay",
    subject=f"Go-live cost estimate {DOC_REF}",
)
frame = Frame(MARGIN, 19 * mm, CONTENT_W, PAGE_H - 13 * mm - 19 * mm, id="body",
              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
doc.addPageTemplates([PageTemplate(id="main", frames=[frame], onPage=draw_page)])
doc.build(story)
print("wrote", OUT)
