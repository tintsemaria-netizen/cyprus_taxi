"""Builds the IL-Y lawyer/accountant briefing PDFs (EN, RU, EL). Usage: python3 build.py <out-dir>"""
import sys, os, importlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, ListFlowable, ListItem, KeepTogether)

F = '/usr/share/fonts/truetype/dejavu/'
pdfmetrics.registerFont(TTFont('DV', F + 'DejaVuSans.ttf'))
pdfmetrics.registerFont(TTFont('DVB', F + 'DejaVuSans-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DVI', F + 'DejaVuSans-Oblique.ttf'))
pdfmetrics.registerFontFamily('DV', normal='DV', bold='DVB', italic='DVI', boldItalic='DVB')

INK = colors.HexColor('#1B2226'); MUTED = colors.HexColor('#5A666C'); LIME = colors.HexColor('#7DA312')
LINE = colors.HexColor('#D5DBDD'); SOFT = colors.HexColor('#F2F5EC')

S = {
    'title': ParagraphStyle('t', fontName='DVB', fontSize=17, leading=21, textColor=INK, spaceAfter=6),
    'sub': ParagraphStyle('s', fontName='DV', fontSize=10.5, leading=14, textColor=MUTED, spaceAfter=4),
    'meta': ParagraphStyle('m', fontName='DV', fontSize=8.5, leading=11, textColor=MUTED, spaceAfter=8),
    'disc': ParagraphStyle('d', fontName='DVI', fontSize=8.5, leading=11.5, textColor=INK, backColor=SOFT, borderPadding=6, spaceAfter=10),
    'h1': ParagraphStyle('h1', fontName='DVB', fontSize=12.5, leading=16, textColor=INK, spaceBefore=10, spaceAfter=5, keepWithNext=1),
    'h2': ParagraphStyle('h2', fontName='DVB', fontSize=10.5, leading=14, textColor=LIME, spaceBefore=8, spaceAfter=4, keepWithNext=1),
    'p': ParagraphStyle('p', fontName='DV', fontSize=9.5, leading=13.2, textColor=INK, spaceAfter=5),
    'li': ParagraphStyle('li', fontName='DV', fontSize=9.5, leading=13.2, textColor=INK),
    'cell': ParagraphStyle('c', fontName='DV', fontSize=8.6, leading=11.2, textColor=INK),
    'cellh': ParagraphStyle('ch', fontName='DVB', fontSize=8.6, leading=11.2, textColor=colors.white),
    'note': ParagraphStyle('n', fontName='DVI', fontSize=8.5, leading=11.5, textColor=MUTED, spaceBefore=4, spaceAfter=6),
    'src': ParagraphStyle('sr', fontName='DV', fontSize=8, leading=10.5, textColor=MUTED),
}


def lst(items, ordered, style):
    return ListFlowable([ListItem(Paragraph(t, S[style]), leftIndent=14) for t in items],
                        bulletType='1' if ordered else 'bullet', start=1 if ordered else None,
                        bulletFontName='DV', bulletFontSize=8.5 if not ordered else 9, leftIndent=14,
                        bulletColor=LIME if not ordered else INK, spaceAfter=4)


def table(rows, width):
    n = len(rows[0])
    cw = [width * 0.46] + [width * 0.54 / (n - 1)] * (n - 1) if n == 3 and rows[0][0] == '' else None
    if cw is None:
        cw = [width * 0.22, width * 0.53, width * 0.25] if n == 3 else [width / n] * n
    data = [[Paragraph(c, S['cellh' if i == 0 else 'cell']) for c in r] for i, r in enumerate(rows)]
    t = Table(data, colWidths=cw, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), INK), ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('GRID', (0, 0), (-1, -1), 0.4, LINE), ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F7F9F9')]),
        ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
    ]))
    return t


def build(lang, out):
    m = importlib.import_module(f'content_{lang}')
    path = os.path.join(out, {'en': 'IL-Y_briefing_lawyer_accountant_EN.pdf', 'ru': 'IL-Y_spravka_advokat_buhgalter_RU.pdf',
                              'el': 'IL-Y_enimerotiko_dikigoros_logistis_EL.pdf'}[lang])
    footer = {'en': 'IL-Y · briefing for lawyer and accountant · page', 'ru': 'IL-Y · справка для адвоката и бухгалтера · стр.',
              'el': 'IL-Y · σημείωμα για δικηγόρο και λογιστή · σελ.'}[lang]

    def on_page(c, d):
        c.saveState(); c.setFont('DV', 7.5); c.setFillColor(MUTED)
        c.drawString(18 * mm, 10 * mm, f'{footer} {d.page}')
        c.setFillColor(LIME); c.rect(18 * mm, A4[1] - 12 * mm, 24 * mm, 1.6 * mm, stroke=0, fill=1)
        c.restoreState()

    doc = SimpleDocTemplate(path, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=18 * mm, bottomMargin=17 * mm,
                            title=m.TITLE, author='IL-Y', subject=m.SUB)
    W = A4[0] - 36 * mm
    st = [Paragraph(m.TITLE, S['title']), Paragraph(m.SUB, S['sub']), Paragraph(m.META, S['meta']), Paragraph(m.DISCLAIMER, S['disc'])]
    pending_h = None
    for kind, val in m.C:
        if kind in ('h1', 'h2'):
            pending_h = Paragraph(val, S[kind]); continue
        if kind == 'p': f = Paragraph(val, S['p'])
        elif kind == 'ul': f = lst(val, False, 'li')
        elif kind == 'ol': f = lst(val, True, 'li')
        elif kind == 'table': f = table(val, W)
        elif kind == 'note': f = Paragraph(val, S['note'])
        elif kind == 'src': f = lst(val, False, 'src')
        if pending_h is not None:
            short = kind in ('p', 'note', 'table') or (kind in ('ul', 'ol', 'src') and len(val) <= 6)
            st.append(KeepTogether([pending_h, f]) if short else pending_h)
            if not short: st.append(f)
            pending_h = None
        else:
            st.append(f)
        if kind == 'table': st.append(Spacer(1, 6))
    doc.build(st, onFirstPage=on_page, onLaterPages=on_page)
    return path


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/briefing'
    os.makedirs(out, exist_ok=True)
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    for lang in ('en', 'ru', 'el'):
        print(build(lang, out))
