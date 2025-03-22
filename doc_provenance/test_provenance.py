import provenance
import data_digestion
import os 
current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)

sufficient_provenance_strategy_pool = ['raw','embedding_sufficient_top_down','embedding_sufficient_bottem_up','divide_and_conquer_sufficient', 'LLM_score_sufficient_top_down', 'LLM_score_sufficient_bottem_up']
minimal_provenance_strategy_pool = ['sequential_greedy', 'exponential_greedy', 'null']

def hotpot_pipeline():
    data_path = parent_directory + '/data/hotpotQA_fullwiki.json'
    folder_path = parent_directory + '/out/hotpotQA'
    hotpot_objects = data_digestion.digest_hotpotQA_dataset(data_path)
    #print(len(hotpot_objects))

    num_of_case = 5

    i = -1
    for e in hotpot_objects:
        i += 1
        q = e['question']
        instruction = e['instruction']
        question = (q, instruction)
        text = e['context']
        title = e['document_name']
        #print(question)

        for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
            for minimal_provenance_strategy in minimal_provenance_strategy_pool:
                strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
                #print(strategy)
                if sufficient_provenance_strategy != 'divide_and_conquer_sufficient':
                    continue
                if minimal_provenance_strategy != 'null':
                    continue

                path = folder_path + '/results/' + 'hotpot' + '_q' + str(i) + '_' + strategy + '.json'
                print(path)
                if not os.path.exists(folder_path + '/results'):
                    os.makedirs(folder_path + '/results')
                # if os.path.isfile(path):
                #     continue
                embedding_path = folder_path + '/embeddings/' + 'hotpot' + '_q' + str(i) + '_embeddings.npy'
                provenance.logger(text, question, title, path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'string', embedding_path=embedding_path)
        if i > num_of_case:
            break

if __name__ == "__main__":
    hotpot_pipeline()