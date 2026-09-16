import { useState } from "react";

export function useAdminProjectForms() {
  const [projectOpen, setProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [assignmentProjectId, setAssignmentProjectId] = useState("");
  const [assignmentUserId, setAssignmentUserId] = useState("");

  return {
    projectOpen,
    setProjectOpen,
    projectName,
    setProjectName,
    assignmentProjectId,
    setAssignmentProjectId,
    assignmentUserId,
    setAssignmentUserId,
  };
}
