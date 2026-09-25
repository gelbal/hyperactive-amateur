// ABOUTME: MoodLoadBoundary — catches a Mood screen that fails to load or render and shows one reload line.
// ABOUTME: After a deploy an open app's lazy Mood chunk can 404; without this the whole app goes blank.
import { Component, type ReactNode } from "react";
import { LoadFailedNotice } from "./LoadFailedNotice";
import { LOG_EVENTS, logger } from "../lib/logger";

interface MoodLoadBoundaryProps {
  children: ReactNode;
}

interface MoodLoadBoundaryState {
  failed: boolean;
}

export class MoodLoadBoundary extends Component<MoodLoadBoundaryProps, MoodLoadBoundaryState> {
  state: MoodLoadBoundaryState = { failed: false };

  static getDerivedStateFromError(): MoodLoadBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    logger.error(LOG_EVENTS.MOOD_LOAD_FAILED, {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <LoadFailedNotice
          label="Mood could not be opened"
          message="Couldn't open Mood — reload to try again."
        />
      );
    }
    return this.props.children;
  }
}
