'use client';

import { ark, type HTMLArkProps } from '@ark-ui/react/factory';
import {
  Tour as TourPrimitive,
  useTour,
  useTourContext,
  waitForElement,
  waitForElementValue,
  waitForEvent,
  waitForPromise,
} from '@ark-ui/react/tour';
import type { ComponentProps, ComponentRef } from 'react';
import { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import {
  OverlayPortal,
  OverlayPortalProvider,
  type OverlayPortalProps,
} from '../../lib/overlayPortal';
import { CloseButton } from '../close-button';

const DEFAULT_CLOSE_BUTTON_LABEL = 'Close tour';

type TourRootProps = ComponentProps<typeof TourPrimitive.Root> & OverlayPortalProps;
type TourCloseIconProps = Omit<ComponentProps<typeof TourPrimitive.CloseTrigger>, 'asChild'>;

function Tour({
  lazyMount = true,
  portalled,
  portalRef,
  unmountOnExit = true,
  ...props
}: TourRootProps) {
  return (
    <OverlayPortalProvider portalled={portalled} portalRef={portalRef}>
      <TourPrimitive.Root lazyMount={lazyMount} unmountOnExit={unmountOnExit} {...props} />
    </OverlayPortalProvider>
  );
}

const TourBackdrop = forwardRef<
  ComponentRef<typeof TourPrimitive.Backdrop>,
  ComponentProps<typeof TourPrimitive.Backdrop>
>(function TourBackdrop({ className, ...props }, ref) {
  return (
    <OverlayPortal>
      <TourPrimitive.Backdrop
        ref={ref}
        className={cn(
          'z-[calc(50+var(--tour-layer,0)+var(--layer-index,0))] bg-overlay backdrop-blur-xs data-[state=closed]:animate-[moduix-fade-out_200ms_ease-in-out_forwards] data-[state=open]:animate-[moduix-fade-in_200ms_ease-in-out] motion-reduce:animate-none',
          className,
        )}
        {...props}
        data-slot="tour-backdrop"
      />
    </OverlayPortal>
  );
});

const TourSpotlight = forwardRef<
  ComponentRef<typeof TourPrimitive.Spotlight>,
  ComponentProps<typeof TourPrimitive.Spotlight>
>(function TourSpotlight({ className, ...props }, ref) {
  return (
    <OverlayPortal>
      <TourPrimitive.Spotlight
        ref={ref}
        className={cn(
          'z-[calc(50+var(--tour-layer,0)+var(--layer-index,0))] ring-2 ring-ring',
          className,
        )}
        {...props}
        data-slot="tour-spotlight"
      />
    </OverlayPortal>
  );
});

const TourPositioner = forwardRef<
  ComponentRef<typeof TourPrimitive.Positioner>,
  ComponentProps<typeof TourPrimitive.Positioner>
>(function TourPositioner({ className, ...props }, ref) {
  return (
    <OverlayPortal>
      <TourPrimitive.Positioner
        ref={ref}
        className={cn(
          'z-[calc(50+var(--tour-layer,0)+var(--layer-index,0))] max-h-[var(--available-height)] max-w-[var(--available-width)] outline-0 [--tour-z-index:var(--moduix-tour-z-index,var(--moduix-z-modal))] data-[type=dialog]:fixed data-[type=dialog]:inset-0 data-[type=dialog]:grid data-[type=dialog]:place-items-center data-[type=dialog]:overflow-y-auto data-[type=dialog]:overscroll-contain data-[type=dialog]:p-g16 data-[type=floating]:fixed data-[type=floating]:max-h-[calc(100dvh-var(--spacing-g42))] data-[type=floating]:max-w-[calc(100vw-var(--spacing-g42))] data-[type=floating]:data-[placement=bottom]:start-1/2 data-[type=floating]:data-[placement=bottom]:bottom-g26 data-[type=floating]:data-[placement=bottom]:-translate-x-1/2 data-[type=floating]:data-[placement=bottom-end]:end-g26 data-[type=floating]:data-[placement=bottom-end]:bottom-g26 data-[type=floating]:data-[placement=bottom-start]:start-g26 data-[type=floating]:data-[placement=bottom-start]:bottom-g26 data-[type=floating]:data-[placement=center]:inset-1/2 data-[type=floating]:data-[placement=center]:-translate-x-1/2 data-[type=floating]:data-[placement=center]:-translate-y-1/2 data-[type=floating]:data-[placement=left]:start-g26 data-[type=floating]:data-[placement=left]:top-1/2 data-[type=floating]:data-[placement=left]:-translate-y-1/2 data-[type=floating]:data-[placement=left-end]:start-g26 data-[type=floating]:data-[placement=left-end]:bottom-g26 data-[type=floating]:data-[placement=left-start]:start-g26 data-[type=floating]:data-[placement=left-start]:top-g26 data-[type=floating]:data-[placement=right]:end-g26 data-[type=floating]:data-[placement=right]:top-1/2 data-[type=floating]:data-[placement=right]:-translate-y-1/2 data-[type=floating]:data-[placement=right-end]:end-g26 data-[type=floating]:data-[placement=right-end]:bottom-g26 data-[type=floating]:data-[placement=right-start]:end-g26 data-[type=floating]:data-[placement=right-start]:top-g26 data-[type=floating]:data-[placement=top]:start-1/2 data-[type=floating]:data-[placement=top]:top-g26 data-[type=floating]:data-[placement=top]:-translate-x-1/2 data-[type=floating]:data-[placement=top-end]:end-g26 data-[type=floating]:data-[placement=top-end]:top-g26 data-[type=floating]:data-[placement=top-start]:start-g26 data-[type=floating]:data-[placement=top-start]:top-g26',
          className,
        )}
        {...props}
        data-slot="tour-positioner"
      />
    </OverlayPortal>
  );
});

const TourContent = forwardRef<
  ComponentRef<typeof TourPrimitive.Content>,
  ComponentProps<typeof TourPrimitive.Content>
>(function TourContent({ className, ...props }, ref) {
  return (
    <TourPrimitive.Content
      ref={ref}
      className={cn(
        'relative z-60 flex max-h-[min(var(--spacing-g377),var(--available-height,100dvh))] w-g377 max-w-[min(calc(100vw-var(--spacing-g34)),var(--available-width,100vw))] origin-[var(--transform-origin)] flex-col gap-g5 overflow-visible rounded-lg border border-border bg-popover p-g21 text-popover-foreground shadow-lg outline-0 has-[>[data-slot=tour-body]]:grid has-[>[data-slot=tour-body]]:grid-rows-[minmax(0,1fr)_auto] data-[state=closed]:animate-moduix-menu-closed data-[state=open]:animate-moduix-menu-open data-[type=dialog]:w-[min(var(--spacing-g377),calc(100vw-var(--spacing-g34)))] data-[type=floating]:w-[min(var(--spacing-g377),calc(100vw-var(--spacing-g34)))] motion-reduce:animate-none',
        className,
      )}
      {...props}
      data-slot="tour-content"
    />
  );
});

const TourArrow = forwardRef<
  ComponentRef<typeof TourPrimitive.Arrow>,
  ComponentProps<typeof TourPrimitive.Arrow>
>(function TourArrow({ className, children, ...props }, ref) {
  return (
    <TourPrimitive.Arrow
      ref={ref}
      className={cn(
        '[--arrow-background:var(--color-popover)] [--arrow-size:var(--spacing-2_5)]',
        className,
      )}
      {...props}
      data-slot="tour-arrow"
    >
      {children ?? <TourArrowTip />}
    </TourPrimitive.Arrow>
  );
});

const TourArrowTip = forwardRef<
  ComponentRef<typeof TourPrimitive.ArrowTip>,
  ComponentProps<typeof TourPrimitive.ArrowTip>
>(function TourArrowTip({ className, ...props }, ref) {
  return (
    <TourPrimitive.ArrowTip
      ref={ref}
      className={cn('border-t border-l border-border !bg-popover', className)}
      {...props}
      data-slot="tour-arrow-tip"
    />
  );
});

const TourTitle = forwardRef<
  ComponentRef<typeof TourPrimitive.Title>,
  ComponentProps<typeof TourPrimitive.Title>
>(function TourTitle({ className, ...props }, ref) {
  return (
    <TourPrimitive.Title
      ref={ref}
      className={cn('pe-g26 text-sm leading-5 font-semibold text-popover-foreground', className)}
      {...props}
      data-slot="tour-title"
    />
  );
});

const TourDescription = forwardRef<
  ComponentRef<typeof TourPrimitive.Description>,
  ComponentProps<typeof TourPrimitive.Description>
>(function TourDescription({ className, ...props }, ref) {
  return (
    <TourPrimitive.Description
      ref={ref}
      className={cn('text-sm leading-5 text-muted-foreground', className)}
      {...props}
      data-slot="tour-description"
    />
  );
});

const TourProgressText = forwardRef<
  ComponentRef<typeof TourPrimitive.ProgressText>,
  ComponentProps<typeof TourPrimitive.ProgressText>
>(function TourProgressText({ className, ...props }, ref) {
  return (
    <TourPrimitive.ProgressText
      ref={ref}
      className={cn('order-1 mt-g8 text-xs leading-4 text-muted-foreground', className)}
      {...props}
      data-slot="tour-progress-text"
    />
  );
});

const TourBody = forwardRef<ComponentRef<typeof ark.div>, HTMLArkProps<'div'>>(function TourBody(
  { className, ...props },
  ref,
) {
  return (
    <ark.div
      ref={ref}
      className={cn('flex min-h-0 flex-col gap-g5 overflow-auto', className)}
      {...props}
      data-slot="tour-body"
    />
  );
});

const TourCloseTrigger = forwardRef<
  ComponentRef<typeof TourPrimitive.CloseTrigger>,
  ComponentProps<typeof TourPrimitive.CloseTrigger>
>(function TourCloseTrigger({ asChild, className, ...props }, ref) {
  return (
    <TourPrimitive.CloseTrigger
      ref={ref}
      asChild={asChild}
      className={cn(
        !asChild &&
          'absolute end-g16 top-g16 inline-flex size-g26 cursor-pointer items-center justify-center rounded-md leading-none text-muted-foreground outline-0 focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring [&>svg]:size-g16 [@media(hover:hover)]:hover:bg-accent [@media(hover:hover)]:hover:text-popover-foreground',
        className,
      )}
      {...props}
      data-slot="tour-close-trigger"
    />
  );
});

const TourCloseIcon = forwardRef<ComponentRef<typeof CloseButton>, TourCloseIconProps>(
  function TourCloseIcon(
    { className, children, 'aria-label': ariaLabel = DEFAULT_CLOSE_BUTTON_LABEL, ...props },
    ref,
  ) {
    return (
      <TourPrimitive.CloseTrigger asChild {...props}>
        <CloseButton
          ref={ref}
          data-slot="tour-close-icon"
          aria-label={ariaLabel}
          className={cn(
            'absolute end-g16 top-g16 size-g26 rounded-md bg-transparent text-muted-foreground transition-[background-color,color,opacity] duration-200 ease-in-out select-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring motion-reduce:transition-none [&>svg]:size-g16 [@media(hover:hover)]:[&:not([data-disabled]):hover]:bg-accent [@media(hover:hover)]:[&:not([data-disabled]):hover]:text-popover-foreground',
            className,
          )}
        >
          {children}
        </CloseButton>
      </TourPrimitive.CloseTrigger>
    );
  },
);

const TourControl = forwardRef<
  ComponentRef<typeof TourPrimitive.Control>,
  ComponentProps<typeof TourPrimitive.Control>
>(function TourControl({ className, ...props }, ref) {
  return (
    <TourPrimitive.Control
      ref={ref}
      className={cn('order-2 mt-g13 flex flex-wrap justify-end gap-g8', className)}
      {...props}
      data-slot="tour-control"
    />
  );
});

const TourActionTrigger = forwardRef<
  ComponentRef<typeof TourPrimitive.ActionTrigger>,
  ComponentProps<typeof TourPrimitive.ActionTrigger>
>(function TourActionTrigger({ asChild, className, ...props }, ref) {
  return (
    <TourPrimitive.ActionTrigger
      ref={ref}
      asChild={asChild}
      className={cn(
        !asChild &&
          "inline-flex min-h-control-sm cursor-pointer items-center justify-center gap-g8 rounded-md border border-border bg-background px-g13 py-g5 text-sm leading-5 font-medium whitespace-nowrap text-foreground no-underline outline-0 transition-[background-color,border-color,color] duration-200 ease-in-out select-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 data-[type=close]:border-primary data-[type=close]:bg-primary data-[type=close]:text-primary-foreground data-[type=next]:border-primary data-[type=next]:bg-primary data-[type=next]:text-primary-foreground motion-reduce:transition-none [@media(hover:hover)]:[&:is([data-type='next'],[data-type='close']):not(:disabled):not([data-disabled]):hover]:border-[color-mix(in_oklab,var(--color-primary),black_12%)] [@media(hover:hover)]:[&:is([data-type='next'],[data-type='close']):not(:disabled):not([data-disabled]):hover]:bg-[color-mix(in_oklab,var(--color-primary),black_12%)] [@media(hover:hover)]:[&:not(:disabled):not([data-disabled]):hover]:bg-accent",
        className,
      )}
      {...props}
      data-slot="tour-action-trigger"
    />
  );
});

const TourActions = TourPrimitive.Actions;

function TourActionList({ className }: { className?: string }) {
  return (
    <TourPrimitive.Actions>
      {(actions) =>
        actions.map((action, index) => (
          <TourActionTrigger
            key={`${action.label}-${index}`}
            action={action}
            className={className}
          />
        ))
      }
    </TourPrimitive.Actions>
  );
}

const TourContext = TourPrimitive.Context;

export {
  Tour,
  TourActionList,
  TourActionTrigger,
  TourActions,
  TourArrow,
  TourArrowTip,
  TourBackdrop,
  TourBody,
  TourCloseIcon,
  TourCloseTrigger,
  TourContent,
  TourContext,
  TourControl,
  TourDescription,
  TourPositioner,
  TourProgressText,
  TourSpotlight,
  TourTitle,
  useTour,
  useTourContext,
  waitForElement,
  waitForElementValue,
  waitForEvent,
  waitForPromise,
};

export type { TourCloseIconProps, TourRootProps };