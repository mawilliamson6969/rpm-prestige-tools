"use client";

import styles from "../../app/(protected)/inbox/inbox.module.css";
import type { TicketRow } from "../../hooks/inbox/types";
import type { UseAIDraft } from "../../hooks/inbox/useAIDraft";
import type { UseCompose } from "../../hooks/inbox/useCompose";
import type { SlaView } from "../../hooks/inbox/useSLA";
import type { UseTeamUsers } from "../../hooks/inbox/useTeamUsers";
import type { UseThreadDetail } from "../../hooks/inbox/useThreadDetail";
import ComposePane from "./ComposePane";
import ErrorBoundary from "./ErrorBoundary";
import InboxDetail from "./InboxDetail";
import RetryState from "./RetryState";

type Props = {
  selectedId: number | null;
  detail: UseThreadDetail;
  teamUsers: UseTeamUsers;
  slaView: SlaView;
  canMetaMailbox: boolean;
  canReplyMailbox: boolean;
  compose: UseCompose;
  aiDraft: UseAIDraft;
  onCloseMobile: () => void;
  onToggleStar: (t: TicketRow) => void;
  onUpdate: (patch: Record<string, unknown>) => void;
  onRunAiDraft: () => void;
  onDismissAiDraft: () => void;
  onSend: () => void;
};

export default function DetailPanelContainer({
  selectedId,
  detail,
  teamUsers,
  slaView,
  canMetaMailbox,
  canReplyMailbox,
  compose,
  aiDraft,
  onCloseMobile,
  onToggleStar,
  onUpdate,
  onRunAiDraft,
  onDismissAiDraft,
  onSend,
}: Props) {
  const noSelection = selectedId == null;
  const showInitialEmpty = noSelection;
  const showRetry = !showInitialEmpty && detail.error && !detail.thread;
  const showLoading = !showInitialEmpty && !showRetry && !detail.thread;
  const showThread = !!detail.thread;

  return (
    <div className={styles.detailPanel}>
      <div className={styles.detailBack}>
        <button type="button" className={styles.backBtn} onClick={onCloseMobile}>
          ← Back
        </button>
      </div>
      {showInitialEmpty ? (
        <div className={styles.detailScrollEmpty}>
          <p className={styles.emptyDetail}>Select a ticket to view details</p>
        </div>
      ) : showRetry ? (
        <RetryState
          message={`Couldn't load this thread. ${detail.error ?? ""}`.trim()}
          onRetry={() => void detail.refetch()}
          retrying={detail.loading}
        />
      ) : showLoading ? (
        <div className={styles.detailScrollEmpty}>
          <p className={styles.emptyDetail}>Loading…</p>
        </div>
      ) : showThread && detail.thread ? (
        <div className={styles.detailBodyColumn}>
          <ErrorBoundary label="ticket detail">
            <InboxDetail
              detail={detail}
              teamUsers={teamUsers}
              slaView={slaView}
              canMetaMailbox={canMetaMailbox}
              onToggleStar={onToggleStar}
              onUpdate={onUpdate}
            />
          </ErrorBoundary>
          <ErrorBoundary label="compose pane">
            <ComposePane
              thread={detail.thread}
              compose={compose}
              aiDraft={aiDraft}
              canReply={canReplyMailbox}
              onRunAiDraft={onRunAiDraft}
              onDismissAiDraft={onDismissAiDraft}
              onSend={onSend}
            />
          </ErrorBoundary>
        </div>
      ) : null}
    </div>
  );
}
