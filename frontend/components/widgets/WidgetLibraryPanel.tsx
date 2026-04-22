"use client";

import hubStyles from "../../app/intranet-hub.module.css";
import {
  DEFAULT_HUB_CARDS,
  WIDGET_LIBRARY,
  type HubCardDef,
  type HubCardLayout,
  type HubWidgetLayout,
  type WidgetDef,
} from "../../lib/layoutPrefs";

type Props = {
  open: boolean;
  onClose: () => void;
  hubLayout: HubCardLayout[];
  hubWidgets: HubWidgetLayout[];
  isAdmin: boolean;
  onAddCard: (card: HubCardDef) => void;
  onAddWidget: (widget: WidgetDef) => void;
};

export default function WidgetLibraryPanel({
  open,
  onClose,
  hubLayout,
  hubWidgets,
  isAdmin,
  onAddCard,
  onAddWidget,
}: Props) {
  if (!open) return null;

  const isCardVisible = (id: string) => {
    const l = hubLayout.find((x) => x.cardId === id);
    return l ? l.visible : false;
  };
  const isWidgetVisible = (id: string) => {
    const l = hubWidgets.find((x) => x.widgetId === id);
    return l ? l.visible : false;
  };

  const availableCards = DEFAULT_HUB_CARDS.filter((c) => !c.adminOnly || isAdmin);

  return (
    <>
      <button
        type="button"
        aria-label="Close widget library"
        className={hubStyles.widgetPanelBackdrop}
        onClick={onClose}
      />
      <aside className={hubStyles.widgetPanel} role="dialog" aria-label="Widget library">
        <div className={hubStyles.widgetPanelHeader}>
          <h2 className={hubStyles.widgetPanelTitle}>Add to Hub</h2>
          <button
            type="button"
            className={hubStyles.widgetPanelClose}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className={hubStyles.widgetPanelBody}>
          <section className={hubStyles.widgetPanelSection}>
            <h3>Tool Cards</h3>
            {availableCards.map((c) => {
              const added = isCardVisible(c.id);
              return (
                <div key={c.id} className={hubStyles.widgetPanelRow}>
                  <span className={hubStyles.widgetPanelIcon} aria-hidden>
                    {c.icon || "🔲"}
                  </span>
                  <div className={hubStyles.widgetPanelInfo}>
                    <p className={hubStyles.widgetPanelName}>{c.title}</p>
                    <p className={hubStyles.widgetPanelDesc}>{c.description}</p>
                  </div>
                  {added ? (
                    <span className={hubStyles.widgetPanelAdded}>Added ✓</span>
                  ) : (
                    <button
                      type="button"
                      className={hubStyles.widgetPanelAddBtn}
                      onClick={() => onAddCard(c)}
                    >
                      Add
                    </button>
                  )}
                </div>
              );
            })}
          </section>

          <section className={hubStyles.widgetPanelSection}>
            <h3>Data Widgets</h3>
            {WIDGET_LIBRARY.map((w) => {
              const added = isWidgetVisible(w.id);
              return (
                <div key={w.id} className={hubStyles.widgetPanelRow}>
                  <span className={hubStyles.widgetPanelIcon} aria-hidden>
                    {w.icon}
                  </span>
                  <div className={hubStyles.widgetPanelInfo}>
                    <p className={hubStyles.widgetPanelName}>{w.name}</p>
                    <p className={hubStyles.widgetPanelDesc}>{w.description}</p>
                  </div>
                  {added ? (
                    <span className={hubStyles.widgetPanelAdded}>Added ✓</span>
                  ) : (
                    <button
                      type="button"
                      className={hubStyles.widgetPanelAddBtn}
                      onClick={() => onAddWidget(w)}
                    >
                      Add
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        </div>
      </aside>
    </>
  );
}
