import type { AuthenticatedUser, WhatsappConversation } from "@/types/api";

export function attendanceLabel(
  status: WhatsappConversation["attendanceStatus"],
): string {
  switch (status) {
    case "waiting":
      return "Aguardando atendimento";
    case "in_progress":
      return "Em atendimento";
    case "finished":
      return "Finalizado";
    default:
      return "Situação indisponível";
  }
}

export function canManageAttendance(
  user: AuthenticatedUser | null,
  conversation: WhatsappConversation,
) {
  const active = !!user?.isActive;
  const inProgress = conversation.attendanceStatus === "in_progress";
  return {
    claim:
      active &&
      conversation.attendanceStatus === "waiting" &&
      !conversation.assignedUserId,
    finish:
      active &&
      inProgress &&
      (user!.isAdmin || user!.id === conversation.assignedUserId),
    assign: active && inProgress && !!user?.isAdmin,
    reopen: active && conversation.attendanceStatus === "finished",
  };
}

export function canSendConversationMessage(
  user: AuthenticatedUser | null,
  conversation: WhatsappConversation,
): boolean {
  return (
    !!user?.isActive &&
    conversation.attendanceStatus === "in_progress" &&
    (user.isAdmin || user.id === conversation.assignedUserId)
  );
}

export function attendanceFields(conversation: WhatsappConversation) {
  return {
    attendanceStatus: conversation.attendanceStatus,
    assignedUserId: conversation.assignedUserId,
    assignedUser: conversation.assignedUser,
    attendanceStartedAt: conversation.attendanceStartedAt,
    attendanceFinishedAt: conversation.attendanceFinishedAt,
  };
}
