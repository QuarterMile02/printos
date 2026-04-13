'use client'

import { Component, type ReactNode } from 'react'

type Props = {
  productName: string
  children: ReactNode
}

type State = {
  hasError: boolean
  errorMessage: string | null
}

export default class ProductFormErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, errorMessage: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message }
  }

  componentDidCatch(error: Error) {
    console.error('[ProductForm] Render error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-base font-bold text-amber-800">Product editor failed to load</h2>
          <p className="mt-1 text-sm text-amber-700">
            The product &ldquo;{this.props.productName}&rdquo; summary is shown above. The interactive editor encountered an error:
          </p>
          <pre className="mt-2 rounded-md bg-amber-100 p-3 text-xs text-amber-900 overflow-auto">
            {this.state.errorMessage}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMessage: null })}
            className="mt-3 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110"
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
