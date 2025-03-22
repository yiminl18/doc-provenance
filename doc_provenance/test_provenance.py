import provenance
import data_digestion

import os
cwd = os.getcwd()
parent_directory = os.path.dirname(cwd)

sufficient_provenance_strategy_pool = ['raw','embedding_sufficient_top_down','embedding_sufficient_bottem_up','divide_and_conquer_sufficient', 'LLM_score_sufficient_top_down', 'LLM_score_sufficient_bottem_up']
minimal_provenance_strategy_pool = ['sequential_greedy', 'exponential_greedy']

def hotpot_pipeline():
    data_path = parent_directory + '/data/hotpotQA_fullwiki.json'
    folder_path = parent_directory + '/out/hotpotQA'
    hotpot_objects = provenance.digest_hotpotQA_dataset(data_path)


    num_of_case = 20

    i = -1
    for e in hotpot_objects:
        i += 1
        q = e['question']
        instruction = e['instruction']
        question = (q, instruction)
        text = e['context']
        title = e['document_name']

        for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
            for minimal_provenance_strategy in minimal_provenance_strategy_pool:
                strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy

                path = folder_path + '/results/' + 'hotpot' + '_q' + str(i) + '_' + strategy + '.json'
                print(path)
                if not os.path.exists(folder_path + '/results'):
                    os.makedirs(folder_path + '/results')
                # if os.path.isfile(path):
                #     continue
                embedding_path = folder_path + '/embeddings/' + 'hotpot' + '_q' + str(i) + '_embeddings.npy'
                provenance.logger(text, question, title, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'string', embedding_path=embedding_path)
        if i > num_of_case:
            break

if __name__ == "__main__":
    hotpot_pipeline()