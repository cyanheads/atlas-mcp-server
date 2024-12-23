/**
 * Manages task status transitions and validation
 */
import { Task, TaskStatus } from '../../types/task.js';

interface StatusTransition {
    from: TaskStatus;
    to: TaskStatus[];
    requiresConditions?: boolean;
}

export class TaskStatusManager {
    
    // Define valid status transitions
    private readonly statusTransitions: StatusTransition[] = [
        // From PENDING
        { 
            from: TaskStatus.PENDING, 
            to: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED, TaskStatus.COMPLETED],
            requiresConditions: true 
        },
        // From IN_PROGRESS
        { 
            from: TaskStatus.IN_PROGRESS, 
            to: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.BLOCKED, TaskStatus.PENDING] 
        },
        // From BLOCKED
        { 
            from: TaskStatus.BLOCKED, 
            to: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
            requiresConditions: true 
        },
        // From COMPLETED
        { 
            from: TaskStatus.COMPLETED, 
            to: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] 
        },
        // From FAILED
        { 
            from: TaskStatus.FAILED, 
            to: [TaskStatus.PENDING] 
        }
    ];

    constructor() {}

    /**
     * Validates a status transition with detailed error messages
     */
    validateStatusTransition(
        task: Task, 
        newStatus: TaskStatus, 
        conditions?: { 
            dependenciesCompleted?: boolean;
            hasBlockedDependencies?: boolean;
            hasFailedDependencies?: boolean;
        }
    ): { valid: boolean; reason?: string } {
        // Find valid transitions for current status
        const transition = this.statusTransitions.find(t => t.from === task.status);
        if (!transition) {
            return { 
                valid: false, 
                reason: `Invalid current status: ${task.status}` 
            };
        }

        // Check if transition is allowed
        if (!transition.to.includes(newStatus)) {
            const validTransitions = transition.to.join(', ');
            return { 
                valid: false, 
                reason: `Cannot transition from ${task.status} to ${newStatus}. Valid transitions are: ${validTransitions}` 
            };
        }

        // Check conditions if required
        if (transition.requiresConditions) {
            if (newStatus === TaskStatus.COMPLETED) {
                // Check dependencies for completion
                if (conditions?.hasBlockedDependencies || conditions?.hasFailedDependencies) {
                    return {
                        valid: false,
                        reason: 'Cannot complete task with blocked or failed dependencies'
                    };
                }
                if (!conditions?.dependenciesCompleted) {
                    return {
                        valid: false,
                        reason: 'Cannot complete task before all dependencies are completed'
                    };
                }
            } else if (newStatus === TaskStatus.IN_PROGRESS) {
                // Check dependencies for starting work
                if (conditions?.hasBlockedDependencies) {
                    return {
                        valid: false,
                        reason: 'Cannot start task with blocked dependencies'
                    };
                }
                if (conditions?.hasFailedDependencies) {
                    return {
                        valid: false,
                        reason: 'Cannot start task with failed dependencies'
                    };
                }
            }
        }

        return { valid: true };
    }

    /**
     * Determines if a task should be blocked based on dependencies
     */
    async shouldBeBlocked(
        task: Task,
        getDependencyStatus: (path: string) => Promise<TaskStatus | null>
    ): Promise<{ blocked: boolean; reason?: string }> {
        if (!task.dependencies.length) {
            return { blocked: false };
        }

        const dependencyStatuses = await Promise.all(
            task.dependencies.map(async (depPath) => {
                const status = await getDependencyStatus(depPath);
                return { path: depPath, status };
            })
        );

        const blockedDeps = dependencyStatuses.filter(
            dep => dep.status === TaskStatus.BLOCKED
        );
        if (blockedDeps.length > 0) {
            return { 
                blocked: true,
                reason: `Blocked by dependencies: ${blockedDeps.map(d => d.path).join(', ')}`
            };
        }

        const failedDeps = dependencyStatuses.filter(
            dep => dep.status === TaskStatus.FAILED
        );
        if (failedDeps.length > 0) {
            return { 
                blocked: true,
                reason: `Dependencies failed: ${failedDeps.map(d => d.path).join(', ')}`
            };
        }

        const incompleteDeps = dependencyStatuses.filter(
            dep => dep.status !== TaskStatus.COMPLETED
        );
        if (incompleteDeps.length > 0) {
            return { 
                blocked: true,
                reason: `Waiting for dependencies: ${incompleteDeps.map(d => d.path).join(', ')}`
            };
        }

        return { blocked: false };
    }

    /**
     * Calculates aggregate status for a parent task based on subtask statuses
     */
    calculateAggregateStatus(subtaskStatuses: TaskStatus[]): TaskStatus {
        if (!subtaskStatuses.length) {
            return TaskStatus.PENDING;
        }

        // Priority order for status aggregation
        if (subtaskStatuses.includes(TaskStatus.BLOCKED)) {
            return TaskStatus.BLOCKED;
        }
        if (subtaskStatuses.includes(TaskStatus.FAILED)) {
            return TaskStatus.FAILED;
        }
        if (subtaskStatuses.includes(TaskStatus.IN_PROGRESS)) {
            return TaskStatus.IN_PROGRESS;
        }
        if (subtaskStatuses.every(s => s === TaskStatus.COMPLETED)) {
            return TaskStatus.COMPLETED;
        }

        return TaskStatus.PENDING;
    }

    /**
     * Gets a human-readable explanation for a task's current status
     */
    getStatusExplanation(task: Task): string {
        switch (task.status) {
            case TaskStatus.BLOCKED:
                return task.dependencies.length > 0
                    ? 'Task is blocked by incomplete dependencies'
                    : 'Task is blocked';
            case TaskStatus.IN_PROGRESS:
                return 'Task is actively being worked on';
            case TaskStatus.COMPLETED:
                return 'Task has been completed successfully';
            case TaskStatus.FAILED:
                return 'Task failed to complete successfully';
            case TaskStatus.PENDING:
                return task.dependencies.length > 0
                    ? 'Task is waiting for dependencies to be completed'
                    : 'Task is ready to be started';
            default:
                return 'Unknown status';
        }
    }
}
