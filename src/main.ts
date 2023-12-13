import * as core from '@actions/core'
import {context, getOctokit} from '@actions/github'
import {GitHub} from "@actions/github/lib/utils";

export async function run(): Promise<void> {
    try {
        const octo: InstanceType<typeof GitHub> = getOctokit(process.env['GITHUB_TOKEN']!!);
        const lastCommit = await octo.rest.repos.getCommit({
            ...context.repo,
            ref: context.sha
        })

        const labels = parseLabelConfig(core.getInput('labels'))

        const tags = await octo.paginate(octo.rest.repos.listTags, {...context.repo})
            .then(response => {
                const map = new Map<string, string>()
                response.forEach(tag => map.set(tag.commit.sha, tag.name));
                return map
            });

        let offset = 0;
        let tag: string | undefined;
        let foundClean: boolean = false;

        outer:
        for await (const response of octo.paginate.iterator(
            octo.rest.repos.listCommits,
            {
                ...context.repo,
                until: lastCommit.data.commit.committer!.date,
                per_page: 100
            },
        )) {
            for (const cmt of response.data) {
                tag = tags.get(cmt.sha);
                if (tag != null) {
                    // If we have a label config, we expect a clean one to exist first
                    // And since we don't want to end with it, we will try to find a non-clean tag
                    if (!foundClean && labels !== undefined && tag.endsWith(labels!.cleanMarker)) {
                        foundClean = true;
                        console.log(`Found clean tag: ${tag}`)
                    } else {
                        break outer;
                    }
                }
                offset++;
            }
        }

        let version = tag == null ? "1.0." + offset : computeVersion(tag, offset);

        // We have a label configuration but we haven't found the clean tag, so append the suffix
        if (labels && !foundClean) {
            version += labels!.label
        }

        core.setOutput("version", version)

        console.log(`Computed version is: ${version}`)
    } catch (error) {
        // Fail the workflow run if an error occurs
        if (error instanceof Error) core.setFailed(error.message)
    }
}

function computeVersion(tag: string, offset: number): string {
    if (tag.startsWith("v")) tag = tag.substring(1); // If the tag starts with v, take it away

    let toAppend = "";
    if (tag.indexOf("-") != -1) {
        const split = tag.split("-", 2);
        toAppend = "-" + split[1]
        tag = split[0]

        console.log(`Found classifier to append: ${split[1]}`)
    }

    const parts = tag.split(".").map(e => parseInt(e));
    console.log(`Found version parts: ${parts.join(", ")}`)
    if (parts.length < 3) {
        parts.push(offset)
    } else {
        parts[parts.length - 1] += offset
    }

    return parts.join(".") + toAppend
}

interface LabelConfig {
    label: string
    cleanMarker: string
}

function parseLabelConfig(config: string): LabelConfig | undefined {
    if (config) {
        const split = config.split(',')
        return {
            label: split[0].trim(),
            cleanMarker: split[1].trim()
        }
    }
    return undefined
}