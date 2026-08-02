'use client'

import { Component, type ErrorInfo, type ReactNode } from 'react'
import {
  BugIcon,
  CircleAlertIcon,
  ClipboardIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const GITHUB_BUG_REPORT_URL = 'https://github.com/codexu/note-gen/issues/new'

interface TabContentErrorBoundaryProps {
  children: ReactNode
  tabName: string
  onClose: () => void
}

interface TabContentErrorBoundaryState {
  error: Error | null
  copied: boolean
  actionError: string
}

export class TabContentErrorBoundary extends Component<
  TabContentErrorBoundaryProps,
  TabContentErrorBoundaryState
> {
  state: TabContentErrorBoundaryState = {
    error: null,
    copied: false,
    actionError: '',
  }

  static getDerivedStateFromError(error: Error): Partial<TabContentErrorBoundaryState> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Failed', error, info.componentStack)
  }

  private getErrorDetails() {
    const { error } = this.state
    return [
      `：${this.props.tabName}`,
      `Error：${error?.message || 'Unknown error'}`,
      `：${new Date().toISOString()}`,
      error?.stack ? `\n${error.stack}` : '',
    ].filter(Boolean).join('\n')
  }

  private retry = () => {
    this.setState({
      error: null,
      copied: false,
      actionError: '',
    })
  }

  private copyErrorDetails = async () => {
    try {
      await navigator.clipboard.writeText(this.getErrorDetails())
      this.setState({ copied: true, actionError: '' })
      window.setTimeout(() => this.setState({ copied: false }), 2000)
    } catch (error) {
      console.error('Error Failed', error)
      this.setState({ actionError: 'None Copy error details，' })
    }
  }

  private reportGitHubIssue = async () => {
    let diagnosticsCopied = false
    try {
      await navigator.clipboard.writeText(this.getErrorDetails())
      diagnosticsCopied = true
    } catch (error) {
      console.error('GitHub Failed', error)
    }

    try {
      const issueUrl = new URL(GITHUB_BUG_REPORT_URL)
      issueUrl.searchParams.set('template', 'bug_report.yml')
      issueUrl.searchParams.set('title', '[bug] Error')
      await openUrl(issueUrl)
      this.setState({
        actionError: diagnosticsCopied
          ? ''
          : 'GitHub ， Error Copy failed， 。',
      })
    } catch (error) {
      console.error('GitHub Failed', error)
      this.setState({ actionError: 'None GitHub ， 。' })
    }
  }

  render() {
    const { children, onClose } = this.props
    const { actionError, copied, error } = this.state

    if (!error) return children

    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/30 p-4">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>This tab encountered an error</CardTitle>
            <CardDescription>
              Only this tab stopped rendering. The sidebar, other tabs, and settings still work.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertTitle>Error details</AlertTitle>
              <AlertDescription className="max-h-24 overflow-auto break-words font-mono text-xs">
                {error.message || 'Unknown error'}
              </AlertDescription>
            </Alert>
            {actionError ? (
              <Alert variant="destructive">
                <CircleAlertIcon />
                <AlertTitle>Operation failed</AlertTitle>
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button onClick={this.retry}>
                <RefreshCwIcon data-icon="inline-start" />
                Retry this tab
              </Button>
              <Button variant="outline" onClick={onClose}>
                <XIcon data-icon="inline-start" />
                Close this tab
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={() => void this.copyErrorDetails()}>
                <ClipboardIcon data-icon="inline-start" />
                {copied ? 'Copy error details' : 'Copy error details'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void this.reportGitHubIssue()}>
                <BugIcon data-icon="inline-start" />
                Report GitHub Issue
              </Button>
            </div>
          </CardFooter>
        </Card>
      </div>
    )
  }
}
